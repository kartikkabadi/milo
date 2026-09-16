# Anti-patterns

Mistakes that are easy to make in this architecture, expensive to discover, and
invisible in a monthly total. Each one names the cost model section that prices
it, so the argument is checkable rather than asserted.

---

## 1. Confusing an agent-hour with a container-hour

**The mistake.** "Ten agents for ten hours a day is 3,000 hours, so I need 3,000
hours of container."

**Why it is wrong.** An agent on shift is mostly waiting on a model, reading a
file, or assembling a patch. None of those need a filesystem. In the modelled
mix, 92% of turns never touch the container.

**What it costs.** $19.29/month instead of $7.02. Nearly 3x, for no additional
capability. See `COST_MODEL.md` §3.

**The tell.** You are budgeting container-hours against agent-hours.

---

## 2. `keepAlive: true`

**The mistake.** "The container should be warm so it responds fast."

**Why it is wrong.** Memory and disk bill on **provisioned** size. A warm idle
container costs $8.00 a month in memory and disk alone, to do nothing. And it is
not even fast: a lite instance waking from sleep is a few hundred milliseconds.

**What it costs.** $12.99/month for an idle container, plus a 30x idiot index on
awake-time-versus-useful-work. See `COST_MODEL.md` §2.

**The tell.** You justified it with latency and never measured the latency.

---

## 3. Paying the sleep tail once per action

**The mistake.** Every Tier-3 action wakes the container, runs, and sleeps. The
60-second tail is charged after each one.

**Why it is wrong.** At 82.6 tests an hour, the tail alone is 4,957 seconds —
38% more than the hour contains. The container never gets to sleep, so you pay
for a box that is awake 100% of the time to do 27% of a box's work.

**What it costs.** $15.70/month instead of $7.02. See `COST_MODEL.md` §4.

**The tell.** Your container-hours exceed your useful exec hours by more than
about 2x. The GUI shows this ratio; that is what the `awakeIndex` field is for.

---

## 4. Running tests in a container when an isolate would do

**The mistake.** All tests are Tier 3, because "tests run code."

**Why it is wrong.** Most unit tests are pure JS: no filesystem, no native
binaries, no network. A Dynamic Worker isolate runs them at Tier 2 for free.
Only the tests that genuinely need a real filesystem need a container.

**What it costs.** In the modelled mix, offloading 60% of tests cuts container
exec from 991 s/agent-hour to 397 s/agent-hour. That is the difference between
$11.00 and $7.02. See `COST_MODEL.md` §4.

**The tell.** You have never asked, per test file, whether it touches a disk.

---

## 5. Holding the Durable Object awake across a container call

**The mistake.** `await sandbox.exec(...)` from inside a DO method, and the DO
stays resident for the whole build.

**Why it is wrong.** A DO bills 128 MiB per second for every second it is awake
and not eligible for hibernation, including the seconds it spends waiting on I/O
it is not doing.

**What it costs.** Up to 30x on DO duration. See `COST_MODEL.md` §8.

**The tell.** Your DO duty cycle tracks your container duty cycle.

**The fix.** Await the sandbox from a fiber and let the DO hibernate.

---

## 6. Trusting a shutdown hook

**The mistake.** Snapshot in `onStop`, or on `SIGTERM`, or "when the container
gets evicted."

**Why it is wrong.** There is no `onStop` in the Agents SDK lifecycle. A Durable
Object can be evicted between two lines of your code with no callback. The
runtime gives in-flight work a grace period, not a guarantee.

**What it costs.** The work since your last snapshot, silently. And because the
failure is silent, you discover it when you need the snapshot most.

**The fix.** Snapshot on a cadence, on quiescence, and before expensive work.
Because every snapshot is a git commit, a missed one costs at most the work since
the last commit and can never corrupt anything. See `agent/snapshot.ts`.

**The tell.** Your persistence code has a comment that says "runs on shutdown."

---

## 7. Snapshotting `node_modules`

**The mistake.** "It is part of the working directory, so it goes in the
snapshot."

**Why it is wrong.** It is the largest thing in the tree, it changes on every
install, and it is fully reconstructible from a lockfile that is already
committed.

**What it costs.** Snapshot size goes from kilobytes to hundreds of megabytes.
At $0.015/GB-month that is not the problem — the problem is the upload time on
every sleep, which delays the release of the container you are paying for.

**The tell.** Your snapshot object is bigger than your repo.

---

## 8. A periodic sweep for something that is usually idle

**The mistake.** `scheduleEvery(30, checkIfIdle)`.

**Why it is wrong.** This was in Milo's own code, and the load test caught it:
360,000 DO requests a month for ten agents — 36% of the free request budget —
spent on a check that almost always does nothing. It was free in dollars and
expensive in the budget that runs out first.

**What it costs.** 36% of your free DO requests, permanently. See
`COST_MODEL.md` §10.

**The fix.** Arm a one-shot alarm when activity happens. An idle session
generates zero requests.

**The tell.** You have a cron whose usual outcome is "nothing to do."

---

## 9. Unindexed reads on a hot render path

**The mistake.** `SELECT *` per keystroke to render a timeline.

**Why it is wrong.** DO rows read are billed: 25B/month included, then
$0.001/million. A full scan per keystroke gets there faster than you think, and
it is also just slow.

**What it costs.** A 50x idiot index on rows read. See `COST_MODEL.md` §8.

**The tell.** A render path issues a query without a `WHERE` on an indexed column.

---

## 10. Raising `max_instances` to fix latency

**The mistake.** Agents queue for the container, so add more containers.

**Why it is wrong.** It works, and it multiplies the overage linearly. It is also
usually the wrong lever: if the queue is long because 20% of turns need a
filesystem, the cheap fix is to make fewer turns need a filesystem.

**What it costs.** Roughly 2x the container overage per instance, for a queue
that would drain anyway if you offloaded more tests. See `COST_MODEL.md` §10.

**The tell.** You reached for capacity before you checked whether the demand was
necessary.

---

## 11. Hard-coding a rate

**The mistake.** `const MEMORY_RATE = 0.0000025;` somewhere in a request path.

**Why it is wrong.** Rates change. A stale rate produces a confidently wrong
ledger, and a confidently wrong ledger is worse than no ledger because people
budget against it.

**The fix.** Every rate lives in `workers/api/src/cost/rates.ts` with the URL it
came from and the date it was read. Two implementations exist (Worker and CLI)
and `bun run check` verifies they agree.

**The tell.** A number with six decimal places and no comment.

---

## 12. Silent degradation

**The mistake.** A harness asked to do something outside its tier list gets
quietly downgraded, or a tool that fails gets swallowed.

**Why it is wrong.** `--yolo` running outside Tier 3 is a security bug, not a
performance bug. And a silently-skipped restore is a data-loss bug that looks
like a success.

**The fix.** `assertTier` throws. `restoreSnapshot` returns `skippedBigFiles`
and the CLI prints them. `milo doctor` reports blockers with a fix.

**The tell.** A `catch {}` with an empty body.
