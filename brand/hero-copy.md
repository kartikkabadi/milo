# Landing page copy and order

Ship the sections in this order. The order is the argument, not a preference.

---

## Nav

```
milo        Docs   Themes   Cost   GitHub   [Get started]
```

Mono `milo` only in the terminal and CLI contexts. In the nav it is the
wordmark asset, `currentColor`, 24px minimum.

---

## Hero

```
// meet Milo

The watcher that ships while you sleep.

Milo keeps your main green. You keep building.

[Get started]   [Read docs]
```

Below the buttons, two things side by side:

```
git clone https://github.com/kartikkabadi/milo.git
```
with a copy button, and a looping recording of the real GUI. Real product UI.
Not a gradient blob, not a mockup of a UI that does not exist.

**Eyebrow is mono and lowercase.** `// meet Milo` — the double slash is the
comment syntax, which is the only reason it is there.

---

## Numbers strip

Real numbers only. Every one of these is reproduced by `bun run cost`, and the
arithmetic is in `COST_MODEL.md`. If a number here cannot be reproduced, delete
it rather than rounding it.

```
$5.00   base plan, Workers Paid
100     container-hours included per month on a lite instance
3,000   agent-hours modelled
18%     Tier-3 duty at the shipped default
$7.02   total monthly cost for 3,000 agent-hours
30x     the idiot index on keepAlive: true
```

No "99.9% uptime". No "10x faster". No number without a command that prints it.

---

## How it works — Watch, Wake, Prove

Three steps, three screenshots, in this order. Each screenshot is the real UI
in the real state.

**Watch.** `milo watch` binds a session to a repo. The agent reads, thinks, and
edits inside a Durable Object. No container is running. The screenshot is the
session panel with the tier indicator showing `Tier 1` and a cost line reading
`$0.0000`.

**Wake.** Tier-3 work leases the single container. The screenshot is the lease
indicator, the queue showing two waiting sessions, and the sleep/wake ring
opening.

**Prove.** The session sleeps, snapshots to git, and leaves a diff. The
screenshot is the git timeline with a `wip(agent)` commit and the diff viewer
open on it. This is the section that earns trust, so it goes last and it is the
largest.

---

## Live mini-diff

A real, typeable diff widget. Not a screenshot. The visitor can edit the
left-hand side and watch the right-hand side re-render.

Ship it with a real example from the repo, not lorem ipsum. Something honest,
like a two-line fix to a broken retry.

---

## Watch rules — `taste.md` and `milo.yaml`

Two files, side by side, with the exact push/pull semantics:

```
milo pull    # adopt the rules a teammate pushed
milo push    # publish yours
```

`taste.md` is prose rules in plain language. `milo.yaml` is the machine half:
what wakes the agent, what it may touch, what it must ask about.

Show both files in full. This is the section that explains why Milo is not
another chatbot wrapper, so do not abbreviate it.

---

## Milo vs generic

A table. Two columns: **Slop** and **Taste**. No trash talk, no competitor named,
no logos. Compare behaviours, not products.

| Slop | Taste |
|---|---|
| wakes for every step | wakes for the step that needs a filesystem |
| a container per agent, always on | one container, leased and queued |
| deletes the branch on failure | commits a `wip(agent)` and leaves the diff |
| asks permission for `git status` | asks once, for the thing that is destructive |
| reports tokens burned | reports the idiot index |

---

## Three dev quotes

Three quotes, real names, real handles, permission on file. No invented
testimonials. If there are not three, ship two or zero — a fake quote costs more
than a missing one.

---

## Pricing, open source, themes

Three panels:

- **Pricing.** The `$5` base plan, and the honest line: *3,000 agent-hours costs
  $7.02. Here is the arithmetic.* Link `COST_MODEL.md`. Do not hide the overage;
  the whole product is that the overage is visible.
- **Open source.** The repo, no license file, MIT-able code. Say that plainly.
- **Themes.** Seven, with the theme menu rendered live so visitors can click
  through them on the page itself.

---

## FAQ — maximum six

Six questions, answered in two sentences each. Not eight. Six.

1. Does Milo run my code in my account?
2. What happens to my files when a session sleeps?
3. Do I need my own Cloudflare account?
4. Why is there no license?
5. Which harnesses does it support?
6. What does it cost at 10 agents?

---

## Footer

```
milo — the friend that minds your agents

Brand assets · Changelog · Docs · GitHub · Cost model
```

Link the brand assets directly to the files in `brand/`. No newsletter form. No
"made with ♥". No social icons that lead nowhere.
