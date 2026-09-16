# Milo cost model

**Verdict up front.** 3,000 agent-hours a month does **not** fit in the $5 Workers Paid
base plan at a 30/30/20/20 think/read/edit/test mix. The cheapest configuration that
runs that workload costs **$7.02/month**. The $5 base plan is reachable, but only by
cutting container-needing tests to about 3.7% of turns.

Everything below is arithmetic over rates read from the Cloudflare docs on **2026-09-16**.
Every number is reproduced by `npm run cost`. Nothing here is an average or an estimate
dressed up as a fact.

---

## 0. The mistake this model exists to prevent

An **agent-hour** is not a **container-hour**.

An agent is *on shift* for 10 hours a day. Most of that shift it is waiting on a model,
reading a file, or assembling a patch — all of which run in a Durable Object or a Worker,
both of which sit inside included allotments. Only Tier-3 work (exec, test, browser) needs
a container, and a container only bills while it is awake.

So the entire cost question collapses to one number:

> **What fraction of agent-hours needs the container awake?**

Call it *Tier-3 duty*. Every table below is that number, priced.

---

## 1. Included container-hours, by instance type

Memory and disk bill on **provisioned** size, so both bound the free hours. CPU bills on
active usage, so it bounds free hours only at saturation.

| instance | vCPU | mem | disk | memory-bound | disk-bound | **included** |
|---|---|---|---|---|---|---|
| **lite** | 1/16 | 256 MiB | 2 GB | 100.00 h | 100.00 h | **100.00 h** |
| basic | 1/4 | 1 GiB | 4 GB | 25.00 h | 50.00 h | 25.00 h |
| standard-1 | 1/2 | 4 GiB | 8 GB | 6.25 h | 25.00 h | 6.25 h |
| standard-2 | 1 | 6 GiB | 12 GB | 4.17 h | 16.67 h | 4.17 h |
| standard-3 | 2 | 8 GiB | 16 GB | 3.13 h | 12.50 h | 3.13 h |
| standard-4 | 4 | 12 GiB | 20 GB | 2.08 h | 10.00 h | 2.08 h |

For `lite`, memory and disk land on **exactly 100 hours**. That coincidence is the reason
`lite` is the default. It is the only instance type where the included allotment is large
enough to matter.

- memory: `25 GiB-h ÷ 0.25 GiB = 100 h`
- disk: `200 GB-h ÷ 2 GB = 100 h`
- cpu: `375 vCPU-min ÷ (1/16 vCPU × 60 min) = 100 h` at full saturation

All three converge. There is no cheaper box to find.

---

## 2. Keeping a container warm 24/7 — what `keepAlive: true` buys

| | |
|---|---|
| container-hours | 3,000 |
| included | 100.00 h (bound by memory) |
| billable | 2,900.0 h |
| memory | 2,610,000 GiB-s × $0.0000025 = **$6.5250** |
| disk | 20,880,000 GB-s × $0.00000007 = **$1.4616** |
| cpu | 13,500 vCPU-s − 22,500 included = **$0.0000** |
| containers total | **$7.99** |
| DO / R2 / Workers | $0.00 |
| **total with base plan** | **$12.99/month** |

Read that again, because it is not the intuitive result. **An idle container costs almost
nothing in CPU.** 1/16 of a vCPU doing nothing is 13,500 vCPU-seconds a month, which is
*less than the 22,500 vCPU-seconds included*. The entire bill is memory and disk, and both
are charged on provisioned size whether the box does anything or not.

**CPU is the cheap dimension. Idleness is not.** $8.00 of that $12.99 is paying for
256 MiB and 2 GB to exist.

So `keepAlive: true` is not primarily a CPU crime. It is a memory-provisioning crime:
you are renting a box so it can sit there.

---

## 3. Cost versus Tier-3 duty

3,000 agent-hours, `lite`, CPU 85% busy while awake.

| duty | container-h | memory | disk | cpu | overage | **total** |
|---|---|---|---|---|---|---|
| 100.00% | 3,000 | $6.53 | $1.46 | $11.03 | $19.01 | **$24.01** |
| 75.00% | 2,250 | $4.84 | $1.08 | $8.16 | $14.08 | **$19.08** |
| 50.00% | 1,500 | $3.15 | $0.71 | $5.29 | $9.14 | **$14.14** |
| 30.00% | 900 | $1.80 | $0.40 | $2.99 | $5.20 | **$10.20** |
| 10.00% | 300 | $0.45 | $0.10 | $0.70 | $1.25 | **$6.25** |
| **3.33%** | **100** | $0.00 | $0.00 | $0.00 | $0.00 | **$5.00** |

The $5 row is the target, and it is reachable — at 3.33% duty, which is 100 container-hours
across 3,000 agent-hours.

Note that a *working* container at 100% duty ($24.01) costs more than an *idle* container
at 100% duty ($12.99). Waking a container repeatedly is more expensive than leaving it
asleep, because you pay CPU plus the sleep tail. The lesson is not "sleep more". It is
**do fewer, bigger things.**

---

## 4. The actual workload: 30/30/20/20 think/read/edit/test

| task | share | tier | action | vCPU busy | where it runs |
|---|---|---|---|---|---|
| think | 30% | 0 | 250 ms | 0.02 | AI Gateway call from the DO. No container. |
| read | 30% | 1 | 400 ms | 0.05 | DO SQLite index + R2 blob, coarse file ops in one RPC. |
| edit | 20% | 2 | 600 ms | 0.05 | Patch assembled in the DO, applied with `git apply`. |
| test | 20% | 3 | 12,000 ms | 0.85 | **The only action that needs a real filesystem.** |

Turns are modelled as one model call plus one action:

```
model latency 6000 ms + avg action 2715 ms = 8715 ms per turn
413.1 turns per agent-hour
tier-3 actions: 82.6/h
```

### Four ways to run it

| run | exec s/h | awake s/h | duty | container-h | **total** |
|---|---|---|---|---|---|
| A. every test wakes the container, no batching | 991 | 3,600 | 100.0% | 3,000 | **$15.70** |
| B. batch 8 tests per wake | 991 | 1,611 | 44.8% | 1,343 | **$11.13** |
| C. offload 60% of tests to Dynamic Worker isolates | 397 | 2,379 | 66.1% | 1,983 | **$11.00** |
| **D. offload + batch (shipped default)** | 397 | 644 | 17.9% | 537 | **$7.02** |

### Why run A is a trap

```
wakes: 82.62/h, tail costs 4957.0 s per agent-hour
awake: 3600.0 s per agent-hour -> duty 100.00%
CONTAINER SATURATED: the 60s tail alone exceeds the hour.
```

The 60-second sleep tail is charged **after every single test**. At 82.6 tests per
agent-hour, the tail alone is 4,957 seconds — 38% more than the hour contains. The
container never gets to sleep. You are paying for a box that is awake 100% of the time to
do 27% of a box's work.

This is the single most important number in the model, and it is invisible if you only
look at task counts.

### The two levers that fix it

**Delete the container from tests that do not need one.** 60% of unit tests are pure JS
with no filesystem, no native binaries, and no network. They run in a Dynamic Worker
isolate at Tier 2 for free. This is the Musk algorithm's step 2, applied to
infrastructure: the cheapest container call is the one that does not exist.

**Batch wakes.** One wake serving eight tests costs `8 × 12s + 60s = 156s` for 96 seconds
of work — a 1.6x idiot index. One wake serving one test costs `12s + 60s = 72s` for 12
seconds of work — a 6x idiot index. Same tests, same result, 4x the cost.

---

## 5. What it takes to reach the $5 base plan

```
budget: 100 container-hours / 3000 agent-hours
= 120 s of container wake time per agent-hour
= 6.15 container-needing Tier-3 actions per agent-hour
To fit $5 the test share must fall from 20% to 3.7% of turns.
```

That is the honest answer to *"if 3,000 hrs cannot fit in $5 even with aggressive sleep,
prove it with numbers and ship the cheapest config that does."*

- **It cannot fit.** 120 seconds of container time per agent-hour is the entire budget.
  The test actions alone want 991 seconds.
- **The cheapest config that does** is run D: `lite` + `max_instances: 1` +
  `sleepAfter 60s` + `keepAlive false` + isolate offload + batched wakes = **$7.02/month**.

Milo ships run D and prices the gap instead of hiding it. The GUI cost ledger shows the
live Tier-3 duty, so you can see the overage forming before the invoice does.

---

## 6. Durable Objects: where the cliff is

DO duration is free while total DO-awake time stays under **400,000 GB-s**. At 128 MiB
billed per object, that is **3,125,000 DO-seconds** across the fleet.

```
400,000 GB-s ÷ 0.128 GiB = 3,125,000 DO-seconds
3,125,000 s ÷ 3,000 agent-hours = 1,041 s per agent-hour = 28.9% duty
```

| DO duty per agent | result |
|---|---|
| under 28.9% | **$0.00** |
| over 28.9% | billable GB-s round **up** to 1,000,000 → **+$12.50** |

That $12.50 is the cliff. It is not a slope; it is a step. Cross 28.9% by one second and
you pay for a million GB-s you did not use.

Milo targets **24 DO-seconds per agent-hour = 0.7% duty**, comfortably inside. The design
rule that keeps it there: never hold the DO awake across a container call. Await the
sandbox from a fiber and let the DO hibernate.

Requests are not a concern: 1,000,000/month included, and incoming WebSocket messages bill
at a 20:1 ratio. Six hundred thousand billable requests a month is $0.00.

---

## 7. Budget → container-hours

| overage budget | lite container-hours | equivalent duty |
|---|---|---|
| $0.00 | 100.0 h | 3.33% |
| $1.00 | 262.3 h | 8.74% |
| $5.00 | 870.3 h | 29.01% |
| $10.00 | 1,630.2 h | 54.34% |

### The instance ladder, at a fixed 900 container-hours

| instance | total | vs lite |
|---|---|---|
| **lite** | **$10.20** | — |
| basic | $27.08 | 2.66x |
| standard-1 | $66.07 | 6.48x |

**Upgrading the instance type is a 2.66x multiplier for the same work.** The only
justification is a Tier-3 workload that genuinely cannot fit in 256 MiB, and it must come
with an idiot index that proves it. Heavy browser work on `standard-1` is 6.48x and is
gated behind an explicit approval plus a kill timeout for that reason.

---

## 8. The idiot index

```
idiot index = resources actually consumed / theoretical minimum for useful exec
```

Anything above **10x** is flagged, and the three worst are surfaced in the GUI. Five are
tracked:

| index | actual | theoretical | typical | flag |
|---|---|---|---|---|
| container memory | provisioned 256 MiB | peak working set | ~3.2x | no |
| container awake | exec + sleep tail | exec | **1.6x–6x** | sometimes |
| DO duration | DO awake seconds | seconds executing | **30x** if held across a call | **yes** |
| snapshot bytes | bytes written | bytes that changed | ~1.1x | no |
| DO rows read | rows read | rows needed | **50x** on a full scan | **yes** |

The two that actually bite are both about *holding something awake while waiting*:

1. **DO held across a container call** — 30x. The DO bills 128 MiB per second while it
   waits on I/O it is not doing. Fix: fiber + hibernate.
2. **Unindexed timeline render** — 50x. A `SELECT *` per keystroke scans the event table.

Both are architecture mistakes, not tuning mistakes. Neither shows up in a monthly total.
Both show up immediately in a ranked idiot index. That is why the index exists.

---

## 9. What is deliberately excluded

| excluded | why |
|---|---|
| LLM tokens | Out of scope per the brief. In practice this dominates — the model calls here are 6s of a 8.7s turn. |
| Egress | 1 TB/month included in NA/EU. Snapshot traffic is to R2, which does not bill egress. |
| Workers Logs | 20M events included. Milo logs invocations, not turns. |
| Queues | Not used. The DO alarm covers scheduling for less. See `DELETION_LOG.md`. |
| Workflows | Not used. DO alarms plus fibers cover the same ground without a second billing surface. |

## 10. The load test disagrees with the static model, and it is right

`npm run loadtest` runs a discrete-event simulation of the same workload with a
real lease queue in front of `max_instances: 1`. It produces **$7.31**, not the
$7.02 above. The difference is contention, and it is worth understanding.

```
simulated 1,239,021 turns in 460 ms

by tier
  Tier 0     371,746      30.0%    no container
  Tier 1     371,700      30.0%    no container
  Tier 2     396,866      32.0%    no container
  Tier 3      98,709       8.0%    container

container
  Tier-3 requests       98,709
  wakes                 12,339
  exec time             329.03 h
  awake time            534.68 h
  Tier-3 duty           17.82%
  awake / useful exec   1.63x  ok
  worst single wait     14,512.3 s
```

Tier 2 at 32% is the isolate offload working: the 20% test share splits into 8%
that needs a filesystem and 12% that runs in a Dynamic Worker isolate.

### Finding 1: the idle sweep was a no-op that cost 36% of a free budget

A 30-second `scheduleEvery` idle check is **1,200 alarm invocations per
agent-hour**, or 360,000 a month for ten agents. That is $0.00 — under the 1M
included — so it looks free. It is 36% of the free request budget, spent on a
check that almost always does nothing.

**The fix shipped:** the idle check is now a **one-shot alarm**, armed when
activity happens and never rescheduled. An idle session generates zero requests
instead of 1,200 an hour. This is the Musk algorithm's step 2 applied to a cron:
delete it before tuning it.

### Finding 2: one container is not enough for this mix at ten agents

```
container busy 74.3% of the wall clock
534.7 container-hours of demand inside a 720-hour month
worst single wait: 241.9 minutes
```

Above roughly 60% utilisation, a single server with bursty arrivals queues
superlinearly. 74.3% is past that, and the worst wait — four hours — is the
consequence. **The `max_instances: 1` default is oversubscribed at 30/30/20/20
with ten agents.**

Two ways out, and they are not equally good:

| option | effect | cost |
|---|---|---|
| raise `max_instances` to 2 | utilisation drops near 50%, queue drains | **~2x the container overage** |
| raise the isolate offload, or lower the test share | less demand in the first place | **$0** |

The second is free, which is why the shipped default pushes toward it. The
honest summary: **`max_instances: 1` is the cheapest configuration, not the
fastest one.** If your agents are latency-sensitive, pay for the second
container and know exactly what it costs.

---

## 11. Reproducing this document

```sh
npm run cost        # the static model, every table in sections 1-9
npm run loadtest    # the discrete-event simulation, section 10
npm run check       # parity between the two, plus theme drift
```

If a rate changes, change `workers/api/src/cost/rates.ts` and re-run all three.
The rates carry the URL they came from and the date they were read, so a stale
number is visible rather than silent.
