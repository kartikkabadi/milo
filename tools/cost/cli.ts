#!/usr/bin/env node
/**
 * Prints the cost model. Run from the repo root:  npm run cost
 *
 * The output of this script is the source of the tables in COST_MODEL.md.
 * If you change a rate, change it in rates.ts and re-run this.
 */
import { HEADLINE, INSTANCE_TYPES, RATES_SOURCE } from "../../workers/api/src/cost/rates.ts";
import {
  includedContainerHours,
  maxContainerHoursForBudget,
  priceScenario,
  doDurationFreeDutyCycle,
  type Scenario,
} from "../../workers/api/src/cost/model.ts";
import { basePlanRequirement, simulateWorkload, TASK_MIX } from "../../workers/api/src/cost/workload.ts";

const AGENT_HOURS = HEADLINE.targetAgentHours;
const AGENTS = HEADLINE.agents;

const hr = (s: string) => `\n${s}\n${"─".repeat(s.length)}`;
const usd = (n: number) => `$${n.toFixed(2)}`;
const pad = (s: string, n: number) => s.padEnd(n);

console.log(`Milo cost model — read from Cloudflare docs ${RATES_SOURCE.readOn}`);
console.log(`Target workload: ${AGENTS} agents x ${HEADLINE.hoursPerAgentPerDay} h/day x ${HEADLINE.daysPerMonth} days = ${AGENT_HOURS} agent-hours/month`);
console.log(`Base plan: $5.00/mo Workers Paid. LLM tokens excluded, per the brief.`);

/* ------------------------------------------------------------------ */
console.log(hr("1. Included container-hours per instance type"));
console.log(
  pad("instance", 12) + pad("vCPU", 8) + pad("mem", 8) + pad("disk", 8) + pad("mem-bound", 12) + pad("disk-bound", 12) + "included",
);
for (const it of Object.values(INSTANCE_TYPES)) {
  const inc = includedContainerHours(it);
  console.log(
    pad(it.id, 12) +
      pad(it.vcpu.toFixed(4), 8) +
      pad(`${it.memoryMiB}M`, 8) +
      pad(`${it.diskGb}G`, 8) +
      pad(`${inc.memoryHours.toFixed(2)} h`, 12) +
      pad(`${inc.diskHours.toFixed(2)} h`, 12) +
      `${inc.hours.toFixed(2)} h`,
  );
}
console.log(`\nMemory and disk bill on provisioned size, so both bound the free hours.`);
console.log(`For lite they land on exactly 100 h. That is why lite is the right box.`);

/* ------------------------------------------------------------------ */
console.log(hr("2. Keeping a container warm 24/7 (what keepAlive: true buys)"));
const idle = priceScenario({
  name: "keepalive-idle",
  note: "container provisioned and awake for every agent-hour, but idle. CPU is billed on active usage, so an idle container burns almost none.",
  instanceType: "lite",
  agentHours: AGENT_HOURS,
  tier3Duty: 1,
  cpuBusyFraction: 0.02,
  doSecondsPerAgentHour: 24,
  doRequests: 600_000,
  r2ClassA: 60_000,
  r2ClassB: 120_000,
  r2StorageGbMonth: 2,
  workerRequests: 400_000,
  workerCpuMs: 2_000_000,
});
console.log(`container-hours: ${idle.containerHours.toFixed(0)}`);
for (const line of idle.container.breakdown) console.log(`  ${line}`);
console.log(`  containers total: ${usd(idle.container.usd)}`);
console.log(`  DO:   ${usd(idle.durableObjects.usd)}`);
console.log(`  R2:   ${usd(idle.r2.usd)}   Workers: ${usd(idle.workers.usd)}`);
console.log(`\n  Idle container awake 24/7 costs ${usd(idle.total)} / month.`);
console.log(`  Note where that money goes: ${usd(idle.container.memory.usd)} memory + ${usd(idle.container.disk.usd)} disk.`);
console.log(`  Memory and disk bill on PROVISIONED size, so they are charged whether the box does anything or not.`);
console.log(`  CPU is the cheap dimension. Idleness is not.`);

/* ------------------------------------------------------------------ */
console.log(hr("3. Cost vs Tier-3 duty (container-hours = 3000 x duty, lite, CPU 85% busy)"));
console.log(pad("duty", 8) + pad("container-h", 14) + pad("memory", 10) + pad("disk", 10) + pad("cpu", 10) + pad("overage", 10) + "total");
for (const duty of [1, 0.75, 0.5, 0.3, 0.1, 0.0333]) {
  const s: Scenario = {
    name: `duty-${duty}`,
    note: "",
    instanceType: "lite",
    agentHours: AGENT_HOURS,
    tier3Duty: duty,
    cpuBusyFraction: 0.85,
    doSecondsPerAgentHour: 24,
    doRequests: 600_000,
    r2ClassA: 60_000,
    r2ClassB: 120_000,
    r2StorageGbMonth: 2,
    workerRequests: 400_000,
    workerCpuMs: 2_000_000,
  };
  const p = priceScenario(s);
  console.log(
    pad(`${(duty * 100).toFixed(2)}%`, 8) +
      pad(p.containerHours.toFixed(0), 14) +
      pad(usd(p.container.memory.usd), 10) +
      pad(usd(p.container.disk.usd), 10) +
      pad(usd(p.container.cpu.usd), 10) +
      pad(usd(p.overage), 10) +
      usd(p.total),
  );
}

/* ------------------------------------------------------------------ */
console.log(hr("4. The actual workload: 30/30/20/20 think/read/edit/test"));
console.log(`Task mix and tier:`);
for (const t of TASK_MIX) {
  console.log(`  ${pad(t.kind, 7)} ${pad(`${(t.share * 100).toFixed(0)}%`, 5)} tier ${t.tier}  ${pad(`${t.actionMs}ms`, 8)} ${t.note}`);
}

const runs = [
  { label: "A. naive: every test wakes the container, tail 60s, no batching", tier3Share: 1, batchSize: 1, sleepTailMs: 60_000 },
  { label: "B. batch 8 tests per wake", tier3Share: 1, batchSize: 8, sleepTailMs: 60_000 },
  { label: "C. offload 60% of tests to Dynamic Worker isolates", tier3Share: 0.4, batchSize: 1, sleepTailMs: 60_000 },
  { label: "D. offload + batch (the shipped default)", tier3Share: 0.4, batchSize: 8, sleepTailMs: 60_000 },
];

console.log(`\n${pad("run", 58)}${pad("exec s/h", 10)}${pad("awake s/h", 10)}${pad("duty", 9)}${pad("container-h", 13)}total`);
const priced: Record<string, number> = {};
for (const r of runs) {
  const w = simulateWorkload({
    agents: AGENTS,
    agentHours: AGENT_HOURS,
    modelLatencyMs: 6000,
    tier3Share: r.tier3Share,
    sleepTailMs: r.sleepTailMs,
    batchSize: r.batchSize,
  });
  const p = priceScenario({
    name: r.label,
    note: "",
    instanceType: "lite",
    agentHours: AGENT_HOURS,
    tier3Duty: w.tier3Duty,
    cpuBusyFraction: Math.max(0.05, w.cpuBusyFraction),
    doSecondsPerAgentHour: 24,
    doRequests: 600_000,
    r2ClassA: 60_000,
    r2ClassB: 120_000,
    r2StorageGbMonth: 2,
    workerRequests: 400_000,
    workerCpuMs: 2_000_000,
  });
  priced[r.label] = p.total;
  console.log(
    pad(r.label, 58) +
      pad(w.containerExecSecondsPerAgentHour.toFixed(0), 10) +
      pad(w.containerAwakeSecondsPerAgentHour.toFixed(0), 10) +
      pad(`${(w.tier3Duty * 100).toFixed(1)}%`, 9) +
      pad(p.containerHours.toFixed(0), 13) +
      usd(p.total),
  );
}

console.log(`\nWhy A is the expensive one: the 60s sleep tail is charged after every test.`);
const a = simulateWorkload({ agents: AGENTS, agentHours: AGENT_HOURS, modelLatencyMs: 6000, tier3Share: 1, sleepTailMs: 60_000, batchSize: 1 });
console.log(`  ${a.lines.join("\n  ")}`);

/* ------------------------------------------------------------------ */
console.log(hr("5. What it takes to reach the $5 base plan"));
const req = basePlanRequirement({
  freeContainerHours: includedContainerHours(INSTANCE_TYPES.lite).hours,
  agentHours: AGENT_HOURS,
  sleepTailMs: 60_000,
  batchSize: 8,
  tier3Share: 0.4,
});
console.log(`  budget: ${includedContainerHours(INSTANCE_TYPES.lite).hours.toFixed(0)} container-hours / ${AGENT_HOURS} agent-hours`);
console.log(`  = ${((includedContainerHours(INSTANCE_TYPES.lite).hours / AGENT_HOURS) * 3600).toFixed(0)} s of container wake time per agent-hour`);
console.log(`  = ${req.maxContainerActionsPerAgentHour.toFixed(2)} container-needing Tier-3 actions per agent-hour`);
console.log(`  ${req.verdict}`);
console.log(`\n  VERDICT: at 30/30/20/20 with 12s tests, 3,000 agent-hours does NOT fit $5.`);
console.log(`  Cheapest shipped config for the stated workload: ${usd(priced["D. offload + batch (the shipped default)"])} / month.`);
console.log(`  The $5 base plan is reachable only by cutting container-needing tests to ~${(req.maxTestShare * 100).toFixed(1)}% of turns,`);
console.log(`  or by accepting the overage. Milo ships the overage, priced, visible, and off by default.`);

/* ------------------------------------------------------------------ */
console.log(hr("6. Durable Objects: where the cliff is"));
const duty = doDurationFreeDutyCycle(AGENT_HOURS);
console.log(`  DO duration is free while total DO-awake time stays under 400,000 GB-s.`);
console.log(`  At 128 MiB billed per object, that is 3,125,000 DO-seconds across the fleet.`);
console.log(`  Spread over ${AGENT_HOURS} agent-hours: ${(duty * 100).toFixed(1)}% duty cycle per agent.`);
console.log(`  Stay under it and DO duration is $0.00. Cross it and the next billing unit is 1,000,000 GB-s = $12.50.`);
console.log(`  Milo's design targets 24 DO-seconds per agent-hour = ${((24 / 3600) * 100).toFixed(1)}% duty. Comfortably inside.`);

/* ------------------------------------------------------------------ */
console.log(hr("7. Budget -> container-hours, and the instance ladder"));
for (const budget of [0, 1, 5, 10]) {
  const hours = maxContainerHoursForBudget(budget, INSTANCE_TYPES.lite, 0.85);
  console.log(`  $${budget.toFixed(2)} overage buys ${hours.toFixed(1)} lite container-hours (${((hours / AGENT_HOURS) * 100).toFixed(2)}% duty)`);
}
console.log("");
for (const id of ["lite", "basic", "standard-1"]) {
  const it = INSTANCE_TYPES[id];
  const p = priceScenario({
    name: id,
    note: "",
    instanceType: id,
    agentHours: AGENT_HOURS,
    tier3Duty: 0.3,
    cpuBusyFraction: 0.85,
    doSecondsPerAgentHour: 24,
    doRequests: 600_000,
    r2ClassA: 60_000,
    r2ClassB: 120_000,
    r2StorageGbMonth: 2,
    workerRequests: 400_000,
    workerCpuMs: 2_000_000,
  });
  console.log(`  ${pad(id, 12)} 900 container-hours -> ${usd(p.total)}   (${it.note})`);
}
const sameWorkload = (instanceType: string): number =>
  priceScenario({
    name: instanceType,
    note: "",
    instanceType,
    agentHours: AGENT_HOURS,
    tier3Duty: 0.3,
    cpuBusyFraction: 0.85,
    doSecondsPerAgentHour: 24,
    doRequests: 600_000,
    r2ClassA: 0,
    r2ClassB: 0,
    r2StorageGbMonth: 0,
    workerRequests: 0,
    workerCpuMs: 0,
  }).total;

const multiplier = sameWorkload("basic") / sameWorkload("lite");
console.log(
  `\n  Same workload on basic instead of lite: ${usd(sameWorkload("basic"))} vs ${usd(sameWorkload("lite"))} = ${multiplier.toFixed(2)}x.`,
);
console.log(`  Justify any instance upgrade with an idiot index, or do not do it.`);
