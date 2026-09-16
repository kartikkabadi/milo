# Changelog

## Unreleased

### Provider auth in the GUI

- **Connect panel.** The provider list `opencode /connect` and `pi /login`
  show in a TUI now lives in the app's left rail. API keys paste in; OAuth
  signs in without a terminal — device code for GitHub Copilot, browser
  paste-back for Anthropic (Claude Pro/Max) and OpenRouter.
- **AuthVault Durable Object** (`src/auth/`). Credentials are stored
  canonical-and-projected: each entry carries the shape each harness actually
  reads, because Pi and OpenCode do not store OAuth identically (Copilot is
  the proof — Pi keeps the exchanged Copilot token, OpenCode keeps the GitHub
  token).
- **Injection at run time, scoped to the session's container.** OpenCode gets
  `OPENCODE_AUTH_CONTENT` plus `~/.local/share/opencode/auth.json`; Pi gets
  `~/.pi/agent/auth.json`. Written on every Tier-3 run, wake, and launch —
  the container's home directory is ephemeral, so "already written" is not a
  durable fact.
- The browser never sees a stored credential. The API returns provider
  metadata, OAuth display instructions, and a last-four hint.

### Removed

- **Command Code is gone** — adapter, image install, doctor check, theme
  mapping, `--yolo` gating, and the GUI entry. Two harnesses now: Pi and
  OpenCode.

## 0.1.0

First cut. Everything below shipped at once, so this is a description rather
than a diff.

### Control plane

- `MiloSession` — one Durable Object per agent session. State, ledger,
  approvals, git timeline, and a one-shot idle alarm.
- `ContainerGate` — a single lease and a queue in front of `max_instances: 1`.
  Ten agents share one container instead of renting ten to sit idle.
- The four-tier ladder, enforced in code. **Lower tiers cannot boot a
  container**, and a harness asked to work outside its tier list throws rather
  than degrading silently.

### Persistence

- Git as the source of truth, not VM snapshots. Sleep commits a `wip(agent)`
  snapshot; wake restores with `git reset --hard` and `npm ci`.
- Patch **and** bundle snapshots, because they fail differently.
- Untracked-files tarball, because the scratch output is the thing you wanted.
- Big-file manifest, so a restore reports what it did not bring back.
- Stale `index.lock` recovery, because a killed `git` is the most common cause
  of a failed snapshot.
- `node_modules` is never snapshotted. It is reconstructible from a committed
  lockfile.

### Cost

- `COST_MODEL.md`, reproduced by `bun run cost`.
- The idiot index, with the three worst surfaced in the GUI. A cost panel that
  only shows a total hides exactly the thing you need to see.
- `bun run loadtest` — a discrete-event simulation of ten agents at 30/30/20/20
  with a real lease queue.
- `bun run check` — parity between the Worker's cost model and the CLI's, plus
  theme drift.

### Two findings the load test produced, both fixed

- **The idle sweep was a no-op that cost 36% of a free budget.** A 30-second
  `scheduleEvery` is 360,000 DO requests a month for ten agents. Replaced with a
  one-shot alarm armed on activity. An idle session now generates zero requests.
- **One container is oversubscribed at this mix.** 74.3% utilisation, and the
  queue diverges. Documented rather than hidden: `max_instances: 1` is the
  cheapest configuration, not the fastest one.

### Harnesses

- Pi, OpenCode, and Command Code as three separate adapters. Not one abstraction
  over three tools.
- Pi: `--mode json` event stream, allowed in every tier.
- OpenCode: Plan / Explore / Scout stay read-only in Tiers 0–1; Build is Tier 3.
- Command Code: read-only without `--yolo` in Tiers 0–1; `--yolo` is Tier 3 only,
  behind an approval.

### Themes

- Seven themes from one palette source: Spartan Night and Hellas Marble as the
  two defaults, the two originals still shipped, Ion Purple and Halo Ring as
  alternates, and Forge Red gated behind a confirmation.
- Emitted for Pi (53 required tokens + 3 optional), OpenCode (single-mode plus a
  combined `milo-greek`), xterm `ITheme`, and web CSS variables.
- Command Code gets no theme files, because `cmd` has no custom theme JSON.
- No flash of the wrong theme: the theme is resolved inline before first paint,
  and `bun run check` fails if the bootstrap drifts from the palette.

### Brand

- Mark: two shapes. A closed eye and a git branch, with the Greek key cut into
  the stem as a single right-angle step.
- Wordmark: built from strokes, not set in a font, so it cannot reflow or fall
  back to a system serif.
- Rules that are enforced by absence: the wordmark and mark are never locked up,
  there is no license file, and the landing page has three visibly empty quote
  slots instead of three invented ones.

### CLI

- The `milo` CLI: no dependencies, runs from source via `bun run milo`. A
  registry package is planned but not published yet — the README says so.
- `watch`, `status`, `sleep`, `wake`, `cost`, `themes`, `pull`, `push`, `doctor`.
- `milo cost` works with no API and no clone, which is why it duplicates the
  arithmetic — and why the duplication is verified.

### Known gaps

- The web GUI has not been exercised against a live deployed Worker in this
  repo. `bun run dev:api` and `bun run dev:web` are wired but untested end to
  end.
- `packages/sandbox-image/Dockerfile` has not been built. The three harness
  install commands are taken from their official docs, not verified by a build.
- The `idiot-index` module tracks five indices. Two of them — snapshot bytes and
  DO rows read — have never flagged in any simulation. They are the first things
  to cut. See `DELETION_LOG.md`.
