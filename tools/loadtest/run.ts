#!/usr/bin/env node
/**
 * Load test: 10 agents, 30/30/20/20 think/read/edit/test.
 *
 * Run from the repo root:  bun run loadtest
 *
 * This is a discrete-event simulation, not a throughput benchmark, and that is
 * the right tool for the question. The question is not "how many requests per
 * second" — it is "with one container and ten agents, how long does an agent
 * wait, what duty cycle do we actually achieve, and what does it cost".
 *
 * The detail that matters: with `max_instances: 1` the container is a single
 * serialised resource. An agent that wants Tier 3 while another holds the lease
 * has to wait. A naive model that assumes ten independent containers will
 * report a cost and a latency that neither agent will ever see.
 *
 * So this simulation runs a real lease queue. It reports:
 *   - per-agent wait time for the container
 *   - achieved Tier-3 duty cycle (the number the bill is made of)
 *   - the idiot index for awake time vs useful exec
 *   - total monthly cost, and whether it fits the $5 base
 */

import { INSTANCE_TYPES, PLAN_BASE_USD, SECONDS_PER_HOUR } from "../../workers/api/src/cost/rates.ts";
import { containerCost, durableObjectCost, includedContainerHours } from "../../workers/api/src/cost/model.ts";
import { TASK_MIX } from "../../workers/api/src/cost/workload.ts";

interface Config {
  agents: number;
  days: number;
  hoursPerAgentPerDay: number;
  /** Wall-clock ms of model latency per turn. */
  modelLatencyMs: number;
  /** Fraction of test actions that genuinely need a container. */
  tier3Share: number;
  /** How many Tier-3 actions are accumulated into one wake. */
  batchSize: number;
  /** Container sleep tail, seconds. Floor is 60. */
  sleepTailSeconds: number;
  /** Concurrent container instances. 1 is the shipped default. */
  maxInstances: number;
  /** Max Tier-3 wall clock per wake, ms. Beyond this the agent is cut off. */
  maxWakeMs: number;
}

const CONFIG: Config = {
  agents: 10,
  days: 30,
  hoursPerAgentPerDay: 10,
  modelLatencyMs: 6000,
  tier3Share: 0.4,
  batchSize: 8,
  sleepTailSeconds: 60,
  maxInstances: 1,
  maxWakeMs: 120_000,
};

interface Turn {
  atMs: number;
  kind: string;
  tier: number;
  actionMs: number;
  cpuBusy: number;
}

/** Deterministic PRNG. A load test that reports different numbers every run is
 *  a load test nobody trusts. mulberry32, seeded per agent and per day. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Metrics {
  turns: number;
  turnsByTier: Record<number, number>;
  tier3Requests: number;
  tier3Wakes: number;
  /** Seconds the container spent executing useful work. */
  execSeconds: number;
  /** Seconds the container spent awake, including sleep tails. */
  awakeSeconds: number;
  /** Seconds spent deliberately accumulating a batch. A design choice, not a queue. */
  batchDelaySeconds: number;
  /** Seconds spent waiting for the container to be free. This is the queue. */
  waitSeconds: number;
  /** Times a wake exceeded maxWakeMs. */
  overruns: number;
  /** The single worst queue wait, seconds. */
  worstWaitSeconds: number;
}

const pad = (s: string, n: number) => s.padEnd(n);
const num = (n: number, d = 1) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Build the event timeline for the whole fleet, then run it through the shared
 * container with a lease queue.
 */
function simulate(cfg: Config): Metrics {
  const m: Metrics = {
    turns: 0,
    turnsByTier: { 0: 0, 1: 0, 2: 0, 3: 0 },
    tier3Requests: 0,
    tier3Wakes: 0,
    execSeconds: 0,
    awakeSeconds: 0,
    batchDelaySeconds: 0,
    waitSeconds: 0,
    overruns: 0,
    worstWaitSeconds: 0,
  };

  const actionAvgMs = TASK_MIX.reduce((a, t) => a + t.share * t.actionMs, 0);
  const turnMs = cfg.modelLatencyMs + actionAvgMs;
  const testSpec = TASK_MIX.find((t) => t.kind === "test")!;

  /* 1. Build every turn for every agent on one global timeline. A single
   *    timeline is what makes the lease queue meaningful: with ten private
   *    timelines there is no contention to model. */
  const timeline: Turn[] = [];
  for (let a = 0; a < cfg.agents; a++) {
    // Stagger agent starts. Agents on shift overlap; they do not synchronise.
    const offsetMs = (a / cfg.agents) * cfg.hoursPerAgentPerDay * 3_600_000;
    const rnd = mulberry32(0x9e3779b9 ^ (a * 2654435761));

    for (let d = 0; d < cfg.days; d++) {
      const dayStart = d * 24 * 3_600_000 + offsetMs;
      const shiftEnd = dayStart + cfg.hoursPerAgentPerDay * 3_600_000;
      let t = dayStart;

      while (t < shiftEnd) {
        // Pick the action from a uniform draw over the mix.
        const r = rnd();
        let acc = 0;
        let spec = TASK_MIX[TASK_MIX.length - 1];
        for (const s of TASK_MIX) {
          acc += s.share;
          if (r <= acc) {
            spec = s;
            break;
          }
        }

        // The isolate offload happens HERE, at decision time, so the tier
        // counts below are the tiers that actually ran.
        let tier = spec.tier;
        if (spec.kind === "test" && rnd() > cfg.tier3Share) {
          // A pure-JS suite. It runs in a Dynamic Worker isolate at Tier 2 and
          // never touches the container.
          tier = 2;
        }

        timeline.push({ atMs: t, kind: spec.kind, tier, actionMs: spec.actionMs, cpuBusy: spec.cpuBusy });
        m.turns++;
        m.turnsByTier[tier] = (m.turnsByTier[tier] ?? 0) + 1;

        if (tier === 3) m.tier3Requests++;

        t += cfg.modelLatencyMs + spec.actionMs;
      }
    }
  }

  timeline.sort((x, y) => x.atMs - y.atMs);

  /* 2. Run the Tier-3 subset through the container gate.
   *
   *    Two different delays, and conflating them is how a load test lies:
   *      batchDelay  — deliberate. We chose to accumulate work so the sleep
   *                    tail amortises. It is not a queue and it is not a bug.
   *      queueWait   — involuntary. Another session held the lease. This is
   *                    the number that says whether max_instances: 1 is
   *                    tolerable or miserable.
   */
  const freeAt: number[] = new Array(cfg.maxInstances).fill(0);
  let batch: Turn[] = [];

  const flush = (): void => {
    if (batch.length === 0) return;

    // The batch is ready when its last action is produced.
    const readyAt = batch[batch.length - 1].atMs;
    const firstAt = batch[0].atMs;
    m.batchDelaySeconds += Math.max(0, (readyAt - firstAt) / 1000);

    // Claim the instance that frees up first.
    let idx = 0;
    for (let i = 1; i < freeAt.length; i++) if (freeAt[i] < freeAt[idx]) idx = i;

    const availableAt = Math.max(freeAt[idx], readyAt);
    const wait = Math.max(0, (availableAt - readyAt) / 1000);
    m.waitSeconds += wait;
    if (wait > m.worstWaitSeconds) m.worstWaitSeconds = wait;

    const execMs = batch.reduce((a, t) => a + t.actionMs, 0);
    const cappedMs = Math.min(execMs, cfg.maxWakeMs);
    if (execMs > cfg.maxWakeMs) m.overruns++;

    m.tier3Wakes++;
    m.execSeconds += cappedMs / 1000;
    // The tail is charged once per wake, after the last exec in the batch.
    m.awakeSeconds += (cappedMs + cfg.sleepTailSeconds * 1000) / 1000;

    freeAt[idx] = availableAt + cappedMs + cfg.sleepTailSeconds * 1000;
    batch = [];
  };

  for (const turn of timeline) {
    if (turn.tier !== 3) continue;
    batch.push(turn);
    if (batch.length >= cfg.batchSize) flush();
  }
  flush();

  return m;
}

function main(): void {
  const cfg = CONFIG;
  const totalAgentHours = cfg.agents * cfg.hoursPerAgentPerDay * cfg.days;

  console.log("milo load test — 10 agents, 30/30/20/20 think/read/edit/test");
  console.log("=".repeat(78));
  console.log(`\nconfig`);
  console.log(`  agents                ${cfg.agents}`);
  console.log(`  agent-hours / month   ${totalAgentHours.toLocaleString()} (${cfg.agents} x ${cfg.hoursPerAgentPerDay}h x ${cfg.days}d)`);
  console.log(`  model latency         ${cfg.modelLatencyMs} ms per turn`);
  console.log(`  container instances   ${cfg.maxInstances}  ${cfg.maxInstances === 1 ? "(the shipped default)" : "(raised)"}`);
  console.log(`  sleep tail            ${cfg.sleepTailSeconds} s`);
  console.log(`  batch size            ${cfg.batchSize} Tier-3 actions per wake`);
  console.log(`  isolate offload       ${((1 - cfg.tier3Share) * 100).toFixed(0)}% of tests never touch the container`);

  const actionAvgMs = TASK_MIX.reduce((a, t) => a + t.share * t.actionMs, 0);
  console.log(`\nturn model`);
  console.log(`  avg action            ${actionAvgMs.toFixed(0)} ms`);
  console.log(`  turn                  ${(cfg.modelLatencyMs + actionAvgMs).toFixed(0)} ms`);
  console.log(`  turns per agent-hour  ${(3_600_000 / (cfg.modelLatencyMs + actionAvgMs)).toFixed(1)}`);

  const t0 = performance.now();
  const m = simulate(cfg);
  const elapsed = performance.now() - t0;

  console.log(`\nsimulated ${m.turns.toLocaleString()} turns in ${elapsed.toFixed(0)} ms`);

  console.log(`\nby tier`);
  for (const t of [0, 1, 2, 3]) {
    const n = m.turnsByTier[t] ?? 0;
    const share = ((n / m.turns) * 100).toFixed(1);
    const container = t === 3 ? "container" : "no container";
    console.log(`  ${pad(`Tier ${t}`, 10)} ${pad(n.toLocaleString(), 12)} ${pad(`${share}%`, 8)} ${container}`);
  }

  console.log(`\ncontainer`);
  console.log(`  Tier-3 requests       ${m.tier3Requests.toLocaleString()}`);
  console.log(`  wakes                 ${m.tier3Wakes.toLocaleString()}`);
  console.log(`  exec time             ${num(m.execSeconds)} s  (${num(m.execSeconds / 3600, 2)} h)`);
  console.log(`  awake time            ${num(m.awakeSeconds)} s  (${num(m.awakeSeconds / 3600, 2)} h)`);
  console.log(`  batch delay           ${num(m.batchDelaySeconds)} s  ${"(deliberate: accumulate work so the tail amortises)"}`);
  console.log(`  queue wait            ${num(m.waitSeconds)} s  ${"(involuntary: the lease was held)"}`);

  const duty = m.awakeSeconds / (totalAgentHours * SECONDS_PER_HOUR);
  const awakeIndex = m.execSeconds > 0 ? m.awakeSeconds / m.execSeconds : 1;

  console.log(`  Tier-3 duty           ${(duty * 100).toFixed(2)}%`);
  console.log(`  awake / useful exec   ${awakeIndex.toFixed(2)}x  ${awakeIndex > 10 ? "FLAGGED (>10x)" : "ok"}`);
  console.log(`  worst single wait     ${num(m.worstWaitSeconds)} s`);
  if (m.overruns > 0) {
    console.log(`  ${m.overruns} wake(s) exceeded the ${cfg.maxWakeMs} ms ceiling — batch smaller`);
  }

  /* Cost */
  const instance = INSTANCE_TYPES.lite;
  const included = includedContainerHours(instance);
  const containerHours = m.awakeSeconds / 3600;
  const cpuBusy = m.awakeSeconds > 0 ? (m.execSeconds * 0.85) / m.awakeSeconds : 0;
  const cc = containerCost({ instance, containerHours, cpuBusyFraction: Math.max(0.05, cpuBusy) });

  // Durable Objects: one per session, and the only recurring cost is the idle
  // sweep. This is where a periodic alarm becomes visible as money.
  const alarmPerDayPerAgent = (cfg.hoursPerAgentPerDay * 3600) / 30;
  const doAlarmRequests = alarmPerDayPerAgent * cfg.agents * cfg.days;
  const doTurnRequests = m.turns * 1.6;
  const doRequests = doAlarmRequests + doTurnRequests;
  const doCost = durableObjectCost({
    doSeconds: totalAgentHours * 24,
    requests: doRequests,
    rowsRead: m.turns * 3,
    rowsWritten: m.turns,
    storageGbMonth: 0.5,
  });

  const total = PLAN_BASE_USD + cc.usd + doCost.usd;

  console.log(`\ncost`);
  console.log(`  container-hours       ${containerHours.toFixed(2)} of ${included.hours.toFixed(0)} included`);
  console.log(`  memory overage        $${cc.memory.usd.toFixed(4)}`);
  console.log(`  disk overage          $${cc.disk.usd.toFixed(4)}`);
  console.log(`  cpu overage           $${cc.cpu.usd.toFixed(4)}`);
  console.log(`  DO duration+requests  $${doCost.usd.toFixed(4)}`);
  console.log(`    of which alarms     ${doAlarmRequests.toLocaleString()} requests (${alarmPerDayPerAgent.toFixed(0)}/day/agent at a 30s sweep)`);
  console.log(`  base plan             $${PLAN_BASE_USD.toFixed(2)}`);
  console.log(`  ${pad("TOTAL", 22)} $${total.toFixed(2)} / month`);

  /* Verdict */
  console.log(`\nverdict`);
  const fits = total <= PLAN_BASE_USD + 0.005;
  if (fits) {
    console.log(`  FITS the $5 base plan. Tier-3 duty ${(duty * 100).toFixed(2)}% is inside the ${((included.hours / totalAgentHours) * 100).toFixed(2)}% budget.`);
  } else {
    console.log(`  DOES NOT fit the $5 base plan. Overage $${(total - PLAN_BASE_USD).toFixed(2)}.`);
    console.log(`  Tier-3 duty ${(duty * 100).toFixed(2)}%, budget ${((included.hours / totalAgentHours) * 100).toFixed(2)}%.`);
    console.log(`  This is the honest number for the stated workload. See COST_MODEL.md.`);
  }

  /* The alarm finding, which is the thing this simulation surfaced that the
   * static model did not. */
  console.log(`\nwhat this simulation surfaced`);
  const alarmUsd = doAlarmRequests > 1_000_000 ? ((doAlarmRequests - 1_000_000) / 1_000_000) * 0.15 : 0;
  console.log(`  1. A 30-second idle sweep is ${doAlarmRequests.toLocaleString()} DO requests a month.`);
  console.log(`     That is $${alarmUsd.toFixed(2)} — under the 1M included, so free in dollars.`);
  console.log(`     But it is ${((doAlarmRequests / 1_000_000) * 100).toFixed(0)}% of the free request budget, spent on a check that almost always does nothing.`);
  console.log(`     Fix: do not sweep on a timer. Schedule a one-shot alarm when activity happens,`);
  console.log(`     so an idle session generates zero requests instead of 1,200 an hour.`);
  console.log(`     This is the Musk algorithm step 2 applied to a cron: delete it before tuning it.`);

  /* Utilisation. The number that decides whether one container is enough. */
  const wallClockHours = cfg.days * 24;
  const utilisation = containerHours / wallClockHours;
  const instancesForHalf = Math.ceil(utilisation / 0.5);

  console.log(`\n  2. The container is busy ${(utilisation * 100).toFixed(1)}% of the wall clock.`);
  console.log(`     ${num(containerHours, 1)} container-hours of demand inside a ${wallClockHours}-hour month.`);
  if (utilisation > 0.6) {
    console.log(`     ${c_or_plain("Above roughly 60%, a single server with bursty arrivals queues superlinearly.")}`);
    console.log(`     The worst wait above is the consequence: ${num(m.worstWaitSeconds / 60, 1)} minutes.`);
    console.log(`     ${cfg.maxInstances} container is NOT enough for this mix at ${cfg.agents} agents.`);
    console.log(`     To hold utilisation near 50% you would need ${instancesForHalf} instances,`);
    console.log(`     which multiplies the container overage by roughly ${instancesForHalf}x.`);
    console.log(`     The cheaper fix is fewer container-needing tests: raise the isolate offload,`);
    console.log(`     or lower the test share. Both are in COST_MODEL.md.`);
  } else {
    console.log(`     One container absorbs this. The queue drains.`);
  }

  const worstWaitRatio = cfg.sleepTailSeconds > 0 ? m.worstWaitSeconds / cfg.sleepTailSeconds : 0;
  console.log(`\nqueue health`);
  console.log(`  worst wait is ${worstWaitRatio.toFixed(1)}x the sleep tail.`);
  if (worstWaitRatio > 30) {
    console.log(`  Agents are queueing badly. See finding 2 above: this is a capacity problem,`);
    console.log(`  not a batching problem.`);
  } else {
    console.log(`  With one container the queue drains. That is the point of max_instances: 1.`);
  }

  console.log(`\nnote: this is a discrete-event simulation of the stated mix, not a benchmark.`);
  console.log(`It models the lease queue, the sleep tail, and the isolate offload, which are`);
  console.log(`the three things that decide the bill. Real numbers will differ; the shape will not.`);
}

/** Plain text, no colour. The load test may be piped, and escape codes in a
 *  piped log are noise. */
function c_or_plain(s: string): string {
  return process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s;
}

main();
