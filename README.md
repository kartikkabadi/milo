# milo

**The watcher that ships while you sleep.**

Milo keeps your main green. You keep building.

Milo is a Cloudflare-native GUI for running cloud coding agents — Pi, OpenCode,
and Command Code — with extreme cost efficiency. Ten agents, ten hours a day,
thirty days: **3,000 agent-hours a month for $7.02**, and every dollar of that is
on screen while it is being spent.

It is not a chatbot wrapper. It is a watcher that wakes on CI fail, leases one
container, runs the thing that needs a filesystem, commits a `wip(agent)`
snapshot, and goes back to sleep.

---

## Quickstart

Milo is a web GUI. It deploys to your own Cloudflare account — there is no Milo
server and nothing to sign up for.

```sh
git clone https://github.com/kartikkabadi/milo.git
cd milo
bun install

bun run dev:api      # wrangler dev, port 8787
bun run dev:web      # vite, port 5273
```

Open http://localhost:5273. The GUI is three columns: the tier ladder and
harness picker on the left; the transcript, terminal, diff viewer, and git
timeline in the centre; and approvals plus the **cost ledger** on the right.

### The CLI

The `milo` command-line companion lives in `packages/milo-cli`. It is not
published to a registry yet — run it from source:

```sh
bun run milo watch     # bind a session to your repo and tail it
bun run milo cost      # the whole cost model, with sources. no API needed.
bun run milo status    # session state, tier, lease, cost, worst idiot indices
bun run milo sleep     # snapshot to git and release the container now
bun run milo wake      # restore from the last snapshot
bun run milo themes    # install all seven themes for every harness
bun run milo pull      # adopt the watch rules a teammate pushed
bun run milo push      # publish your watch rules
bun run milo doctor    # check the environment, with a fix for each problem
```

`milo watch` binds a session to your repo, resumes it if it has been here
before, and prints a live line:

```
milo watch /home/you/code/your-repo
  branch   main
  session  repo-home-you-code-your-repo
  api      http://127.0.0.1:8787
  rules    taste.md

watching. ctrl-c to stop. the session keeps its snapshot either way.

idle         T1 read      no container                 head 4f2a1c8       $0.00
testing      T3 exec      container held               head 4f2a1c8    $0.21/mo
```

---

## The one idea

**An agent-hour is not a container-hour.**

An agent is on shift for ten hours. It spends most of that waiting on a model,
reading a file, or assembling a patch — all of which run in a Durable Object or a
Worker, both inside included allotments. Only exec, test, and browser need a
container.

So Milo routes every action to one of four tiers, and **lower tiers cannot boot a
container**. That is enforced in code, not in a comment.

| tier | what | where | container |
|---|---|---|---|
| 0 | think | AI Gateway, from the Durable Object | no |
| 1 | read | DO SQLite + R2 + Dynamic Worker isolates | no |
| 2 | edit | patch in the DO, `git apply`, isolate tests | no |
| 3 | exec | **the only tier with a container** | yes |

In the modelled 30/30/20/20 mix, **92% of turns never touch the container.**

---

## Does it fit in $5?

**No, and the README says so above the fold.**

`bun run cost` proves it. The included Containers allotment on `lite` is exactly
**100 container-hours a month** — memory and disk both land on 100, which is why
`lite` is the only instance type worth using.

| workload | container-hours | total |
|---|---|---|
| idle container awake 24/7 (`keepAlive: true`) | 3,000 | **$12.99** |
| every test wakes the container | 3,000 (saturated) | **$15.70** |
| batch 8 tests per wake | 1,343 | **$11.13** |
| offload 60% of tests to isolates | 1,983 | **$11.00** |
| **offload + batch — the shipped default** | **537** | **$7.02** |
| the $5 target | 100 | **$5.00** |

The $5 base is reachable only by cutting container-needing tests to about 3.7% of
turns. Milo ships the $7.02 configuration and prices the gap instead of hiding it.

The load test adds one more finding: at ten agents, one container runs at **74%
utilisation** and the queue diverges. `max_instances: 1` is the *cheapest*
configuration, not the fastest one. The free fix is more isolate offload; the paid
fix is a second container at roughly 2x the overage.

Full arithmetic: **[COST_MODEL.md](COST_MODEL.md)**. It is reproduced by
`bun run cost`, `bun run loadtest`, and `bun run check`.

---

## Architecture

```
                    ┌──────────────────────────────┐
   browser ──ws────▶│  MiloSession (Durable Object)│  one per session
                    │  state · ledger · approvals  │  hibernates when idle
                    │  git timeline · idle alarm   │
                    └───────────┬──────────────────┘
                                │ lease
                    ┌───────────▼──────────────────┐
                    │  ContainerGate (DO)          │  one lease, a queue
                    └───────────┬──────────────────┘
                                │
                    ┌───────────▼──────────────────┐
                    │  Sandbox (lite, max_inst=1)  │  Tier 3 only
                    │  sleepAfter 60s              │  no keepAlive, ever
                    └───────────┬──────────────────┘
                                │
              ┌─────────────────┴──────────────────┐
              ▼                                    ▼
      git (source of truth)              R2 (snapshot cache)
      wip(agent) commits                 patch + bundle + manifest
      restored with git reset --hard     7-day lifecycle, one kept
```

**Persistence is git, not VM snapshots.** Disk is ephemeral; Milo does not fight
it. On sleep it commits, uploads a patch and a bundle to R2, and deletes the prior
snapshot. On wake it restores with `git reset --hard` and `npm ci` — overridable,
because the sandbox image also carries bun and pnpm for repos that use them.
`node_modules` is never snapshotted, because it is reconstructible from a
committed lockfile.

**There is no shutdown hook, and the design assumes that.** A Durable Object can
be evicted between two lines of code with no callback. So Milo snapshots on a
cadence and on quiescence, and every snapshot is a git commit — which means a
missed one costs at most the work since the last commit and can never corrupt
anything. See [ANTI-PATTERNS.md](ANTI-PATTERNS.md) §6.

---

## Repo layout

```
apps/web/               React + Tailwind v4 + xterm + useAgent. All seven themes.
workers/api/            Worker + MiloSession DO + ContainerGate + tier ladder.
  src/cost/             rates.ts (with source URLs) · model.ts · workload.ts · idiot-index.ts
  src/agent/            milo-session.ts · snapshot.ts · ledger.ts
  src/harness/          Pi · OpenCode · Command Code, as three separate adapters
  src/gate/             container-gate.ts — the single lease
packages/theme-kit/     one palette source → Pi, OpenCode, xterm, and web CSS
packages/sandbox-image/ Dockerfile: three harnesses, no secrets
packages/milo-cli/      the milo CLI — runs from source via `bun run milo`
brand/                  mark, wordmark, app icon, rules, hero copy, Thiel note
themes/                 GENERATED. Do not hand-edit.
tools/cost/             the cost CLI + parity check
tools/loadtest/         discrete-event simulation, 10 agents
tools/themes/           drift check
COST_MODEL.md           the arithmetic, with sources
DELETION_LOG.md         what was deleted, and what came back
ANTI-PATTERNS.md        twelve mistakes, each priced
```

---

## The GUI

The GUI is the product — see the quickstart above to run it. Three columns: the
tier ladder and harness picker on the left, the transcript, terminal, diff
viewer, and git timeline in the centre, and approvals plus the **cost ledger**
on the right.

The cost ledger leads with the **idiot index** — actual resources divided by the
theoretical minimum — and ranks the three worst. The dollar figure is the last
row, not the first. A cost panel that only shows a total hides exactly the thing
you need to see.

### On `useAgentChat`

Milo uses `useAgent`, not `useAgentChat`, and the reason is not preference.
`useAgentChat` models a message list. Milo's transcript is a typed event stream
where a turn interleaves thinking, tier transitions, approvals, diffs, and a
ledger row — and every one of those carries a tier and a cost. Forcing that
through a chat-message schema would mean smuggling structured data through
message metadata and losing the ordering guarantee that makes the transcript
trustworthy.

---

## Themes

Seven, generated from one palette source in `packages/theme-kit/src/palettes.ts`.
Nothing under `themes/` is hand-edited.

| theme | mode | role |
|---|---|---|
| **Spartan Night** | dark | dark default. Torchlight on charcoal. |
| **Hellas Marble** | light | light default. Marble, law, agora. |
| Milo Dark | dark | original, still shipped |
| Milo Light | light | original, still shipped |
| Ion Purple | dark | alternate |
| Halo Ring | dark | alternate. Ring closes on sleep, opens on wake. |
| Forge Red | dark | **danger and `--yolo` only.** Gated behind a confirmation. |

```sh
bun run themes    # regenerate every artifact
bun run check     # fail if anything drifted
```

Emitted for all seven: Pi theme JSON (53 required tokens + 3 optional), OpenCode
theme JSON (single-mode and a combined `milo-greek` with dark/light variants),
xterm `ITheme`, and web CSS variables. Command Code gets **no files** — `cmd` has
exactly three theme values and no custom JSON, so Milo maps its seven onto
`dark` / `light` / `auto` and says so rather than writing a file `cmd` ignores.

---

## Secrets

**Milo ships no secrets and reads none from the repo.** Every secret is set with
`wrangler secret put` and never enters the container.

| secret | used for |
|---|---|
| `GITHUB_TOKEN` | injected by the outbound handler. The sandbox asks for `http://github.milo.internal` and gets an authenticated `github.com` response. **The token never enters the sandbox.** |
| `AI_GATEWAY_TOKEN` | Tier 0 think, same mechanism via `gateway.milo.internal` |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | only for remote-endpoint bucket mounts |
| `MODEL_PROVIDER_KEY_*` | passed to the harness inside the sandbox, for the model calls it makes directly |

```sh
cd workers/api
bunx wrangler secret put GITHUB_TOKEN
bunx wrangler secret put AI_GATEWAY_TOKEN
```

Egress is deny-by-default (`enableInternet = false` plus an explicit
`allowedHosts` list). A `docker history` on the sandbox image reveals nothing, and
neither does a shell inside it.

---

## Deploy

```sh
cd workers/api
bunx wrangler r2 bucket create milo-snapshots
# set the 7-day lifecycle rule on the snapshots/ prefix
bunx wrangler deploy

cd ../../apps/web
bun run build
bunx wrangler pages deploy dist
```

The `lite` instance type and `max_instances: 1` in `wrangler.jsonc` are the
cheapest configuration. Raise either only with an idiot index that justifies it.

---

## Constraints Milo holds itself to

- Workers Paid only. No Enterprise features.
- No warm pools. No `keepAlive: true`.
- The container is never the primary filesystem.
- 128 MB isolate budget respected: snapshot payloads are capped at 48 MB and
  anything larger goes to R2 with a manifest pointer.
- 5 minutes of CPU per invocation, 15 minutes of wall clock for alarms — the
  snapshot runs as a fiber and is bounded.
- A bigger instance type only with idiot-index math. `basic` is 2.66x `lite` for
  the same work.

---

## License

**No license file, by request.** The code is written to be MIT-able: no copyleft
dependencies, no vendored code, no secrets. Add a `LICENSE` file if you want one.

## Docs

- [COST_MODEL.md](COST_MODEL.md) — the arithmetic, with sources and a load test
- [DELETION_LOG.md](DELETION_LOG.md) — what was deleted, and what came back
- [ANTI-PATTERNS.md](ANTI-PATTERNS.md) — twelve mistakes, each priced
- [brand/brand.md](brand/brand.md) — mark, wordmark, type, colour, motif rules
- [brand/hero-copy.md](brand/hero-copy.md) — landing copy and section order
- [brand/thiel-note.md](brand/thiel-note.md) — what the Greek identity copies, and what it refuses
- [CHANGELOG.md](CHANGELOG.md)
