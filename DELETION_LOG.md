# Deletion log

The Musk algorithm's second step is *delete very hard*, with a test: **if you are
not adding back roughly 10%, you did not delete enough.**

This file records what was deleted, what was added back, and why. A deletion log
that only lists deletions is a log that is hiding the add-backs.

---

## Deleted outright, not added back

| deleted | why | what replaced it |
|---|---|---|
| **Workflows** | A second durable-execution surface with its own billing dimensions (storage GB-mo, steps, requests). The DO alarm plus `runFiber` covers scheduling and recovery for less, and one fewer billing surface is one fewer thing to reason about. | `onAlarm` + `runFiber("snapshot")` |
| **Queues** | 3 operations per delivered message, plus a consumer. Used only for Tier-3 dispatch, which the `ContainerGate` DO now does with a lease and a queue table. | `ContainerGate` |
| **Warm pool** | Explicitly forbidden by the brief, and correct to forbid. A warm pool is a container you pay for so it can exist. | `sleepAfter 60s` |
| **`keepAlive: true`** | 30x idiot index. Priced in `COST_MODEL.md` §2. | Lease + sleep |
| **Full-filesystem primary state** | Disk is ephemeral. Building the product around it would mean fighting the platform. | Git as the source of truth |
| **A global session registry** | A single point of cost and failure. Every request to it is a DO request, and it would need its own storage and its own consistency story. | The GUI knows the ids it opened; the gate knows who holds the lease |
| **`scheduleEvery(30, idleSweep)`** | Found by the load test, not by review. 360,000 DO requests a month for a check that almost always does nothing — 36% of the free request budget. | One-shot alarm armed on activity |
| **A router dependency** | Two pages and one path segment. | A 20-line `parseRoute` |
| **A CLI framework** | `milo` needs `argv`, `fetch`, and `fs`. A framework would be larger than the CLI. | `process.argv` |
| **A config-file format of our own** | `taste.md` and `milo.yaml` are the two files. A third format would be a third thing to document. | YAML + Markdown |
| **Command Code theme JSON** | `cmd` has exactly three theme values and no custom JSON. Writing a file it ignores would be a lie in the repo. | A documented mapping onto `dark` / `light` / `auto` |
| **Landing-page testimonials** | Three invented quotes would have been easy. They cost more than a missing section. | Three reserved, visibly empty slots |

---

## Deleted, then added back

Each of these was removed, then brought back because something broke without it.
That is the 10% test working as intended.

| deleted | why it came back | what it cost to learn |
|---|---|---|
| **The `ContainerGate`** | Deleted as premature — "one container, just let it fail." Then the ninth of ten agents fails when the first holds the lease. A product cannot ship a 90% failure rate at peak. | One DO, near-zero duty cycle |
| **`commitWip`'s stale-lock retry** | Deleted as defensive clutter. Then a killed `git` left `.git/index.lock` behind and every subsequent snapshot failed silently for a session. | 4 lines |
| **The `chmod -R a+rX` step** | Deleted as a workaround for a bug that "should not happen." `createBackup()` needs to read every file, harnesses create `0600` files constantly, and the failure mode is a snapshot that does not happen. | 1 line |
| **The untracked-files tarball** | Deleted as redundant with `git add -A`. Then a harness's scratch output — the thing you actually wanted to read — vanished on sleep, because it was gitignored. | 1 object per snapshot |
| **Big-file manifest** | Deleted as unnecessary metadata. Then a restore silently omitted a 40 MB fixture and the test suite failed with a confusing error. | 1 small JSON per snapshot |
| **The boot script's `try/catch`** | Deleted as paranoia. Then a browser with storage disabled threw before setting `data-theme`, and the page rendered unstyled with no way back. | 3 lines |
| **The `awakeIndex` in the GUI** | Deleted as "nobody wants a ratio." It is the single number that catches the 30x mistake before the invoice does. | One field |

---

## Not deleted, and why

These survived review. Each one is a deliberate exception.

| kept | why |
|---|---|
| **Seven themes** | The brief requires all seven, including the two originals. Forge Red is gated rather than removed, because a danger theme you cannot select is a danger theme nobody learns from. |
| **Two cost implementations** | `milo cost` must work with no API and no clone, so it duplicates the arithmetic. The duplication is verified by `tools/cost/parity.ts` over 40 combinations. Verified duplication is cheaper than a mandatory network call. |
| **Two theme metadata copies** | The Worker must not import the theme generator. Verified by `tools/themes/check.ts`. |
| **`snapshot.ts` writing both a patch and a bundle** | Storage is $0.015/GB-month. A few hundred KB of redundancy removes an entire class of "the patch did not apply" failures. |
| **The tier ladder's four tiers** | Collapsing to "cheap" and "expensive" would lose the thing the product is. |

---

## The count

- **Deleted outright:** 11 things
- **Deleted then added back:** 7 things
- **Add-back rate:** 39%

The 10% test says that is too low, which means **there is still something in this
repo that should not exist.** The most likely candidate is the `idiot-index`
module's fourth and fifth indices — snapshot bytes and DO rows read — which have
never flagged in any simulation. They are kept because they are cheap and because
the moment they do flag, they flag hard. But a reviewer should treat them as the
first things to cut.

That is the honest version. A deletion log that concludes "everything here is
justified" has not been written honestly.
