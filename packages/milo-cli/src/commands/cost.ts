/**
 * milo cost — the cost model, from the CLI.
 *
 * This is a self-contained re-implementation of the arithmetic, deliberately
 * duplicated from workers/api/src/cost/model.ts. The reason: `milo cost` must
 * work with no API running and no repo cloned, because it is the command a
 * person runs *before* deciding whether to install anything.
 *
 * tools/cost/parity.ts checks the two implementations agree, so the duplication
 * is verified rather than trusted.
 */

import { c, usd } from "../lib.ts";

const BASE = 5.0;
const MEMORY_INCLUDED_GIB_H = 25;
const MEMORY_PER_GIB_S = 0.0000025;
const CPU_INCLUDED_VCPU_MIN = 375;
const CPU_PER_VCPU_S = 0.00002;
const DISK_INCLUDED_GB_H = 200;
const DISK_PER_GB_S = 0.00000007;
const DO_DURATION_INCLUDED_GB_S = 400_000;
const DO_DURATION_PER_MILLION_GB_S = 12.5;
const DO_BILLED_MEMORY_GIB = 0.128;

const LITE = { vcpu: 1 / 16, memoryMiB: 256, diskGb: 2, id: "lite" };
const BASIC = { vcpu: 1 / 4, memoryMiB: 1024, diskGb: 4, id: "basic" };

type Instance = typeof LITE;

const includedHours = (i: Instance) =>
  Math.min(MEMORY_INCLUDED_GIB_H / (i.memoryMiB / 1024), DISK_INCLUDED_GB_H / i.diskGb);

function containerCost(i: Instance, hours: number, cpuBusy: number) {
  const inc = includedHours(i);
  const billable = Math.max(0, hours - inc);
  const memory = billable * (i.memoryMiB / 1024) * 3600 * MEMORY_PER_GIB_S;
  const disk = billable * i.diskGb * 3600 * DISK_PER_GB_S;
  const cpuS = hours * i.vcpu * cpuBusy * 3600;
  const cpu = Math.max(0, cpuS - CPU_INCLUDED_VCPU_MIN * 60) * CPU_PER_VCPU_S;
  return { memory, disk, cpu, total: memory + disk + cpu, inc, billable };
}

function doCost(seconds: number) {
  const gibS = seconds * DO_BILLED_MEMORY_GIB;
  const billable = Math.max(0, gibS - DO_DURATION_INCLUDED_GB_S);
  return Math.ceil(billable / 1_000_000) * DO_DURATION_PER_MILLION_GB_S;
}

const pad = (s: string, n: number) => s.padEnd(n);

export async function cost(args: string[]): Promise<number> {
  const agentHours = Number(args.find((a) => /^\d+$/.test(a)) ?? 3000);
  const out = process.stdout;

  out.write(`${c.bold("milo cost")} ${c.dim("— 3,000 agent-hours is the modelled target; pass a number to change it")}\n`);
  out.write(`${c.dim("rates read from the Cloudflare docs on 2026-09-16")}\n`);

  /* Included hours */
  out.write(`\n${c.bold("included container-hours per instance type")}\n`);
  out.write(`${c.dim("memory and disk bill on provisioned size, so both bound the free hours")}\n\n`);
  out.write(`  ${pad("instance", 12)}${pad("vCPU", 10)}${pad("memory", 10)}${pad("disk", 8)}${pad("included", 12)}\n`);
  for (const i of [LITE, BASIC]) {
    out.write(
      `  ${pad(i.id, 12)}${pad(`1/${Math.round(1 / i.vcpu)}`, 10)}${pad(`${i.memoryMiB} MiB`, 10)}${pad(
        `${i.diskGb} GB`,
        8,
      )}${pad(`${includedHours(i).toFixed(2)} h`, 12)}\n`,
    );
  }
  out.write(`\n  ${c.dim("for lite both land on exactly 100 h. that is why lite is the default.")}\n`);

  /* The $5 question */
  out.write(`\n${c.bold("can 3,000 agent-hours fit in $5?")}\n\n`);
  const idle = containerCost(LITE, agentHours, 0.02);
  out.write(`  ${c.dim("an idle container kept awake 24/7, which is what keepAlive: true buys:")}\n`);
  out.write(`    memory  ${usd(idle.memory)}   disk ${usd(idle.disk)}   cpu ${usd(idle.cpu)}\n`);
  out.write(`    total   ${c.bold(usd(BASE + idle.total, 2))} / month\n`);
  out.write(`\n  ${c.yellow("no.")} 3,000 container-hours cannot fit in $5. memory alone is ${usd(idle.memory)}.\n`);
  out.write(`  ${c.dim("the entire bill is memory and disk, and both are charged on provisioned size")}\n`);
  out.write(`  ${c.dim("whether the box does anything or not. CPU is the cheap dimension. idleness is not.")}\n`);

  /* The real workload */
  out.write(`\n${c.bold("the actual workload: 30/30/20/20 think/read/edit/test")}\n\n`);
  const mix = [
    { kind: "think", share: 0.3, tier: 0, actionMs: 250, cpuBusy: 0.02 },
    { kind: "read", share: 0.3, tier: 1, actionMs: 400, cpuBusy: 0.05 },
    { kind: "edit", share: 0.2, tier: 2, actionMs: 600, cpuBusy: 0.05 },
    { kind: "test", share: 0.2, tier: 3, actionMs: 12_000, cpuBusy: 0.85 },
  ];
  const actionAvg = mix.reduce((a, t) => a + t.share * t.actionMs, 0);
  const turnMs = 6000 + actionAvg;
  const turnsPerHour = 3_600_000 / turnMs;
  const testSpec = mix[3];

  out.write(`  ${c.dim(`model latency 6000 ms + avg action ${actionAvg.toFixed(0)} ms = ${turnMs.toFixed(0)} ms per turn`)}\n`);
  out.write(`  ${c.dim(`${turnsPerHour.toFixed(1)} turns per agent-hour, so ${(turnsPerHour * 0.2).toFixed(1)} test actions`)}\n\n`);

  const runs = [
    { label: "A. every test wakes the container", tier3Share: 1, batch: 1 },
    { label: "B. batch 8 tests per wake", tier3Share: 1, batch: 8 },
    { label: "C. offload 60% of tests to isolates", tier3Share: 0.4, batch: 1 },
    { label: "D. offload + batch (shipped default)", tier3Share: 0.4, batch: 8 },
  ];

  out.write(`  ${pad("run", 42)}${pad("exec s/h", 10)}${pad("awake s/h", 11)}${pad("duty", 9)}${pad("hours", 9)}total\n`);
  let shipped = 0;
  for (const r of runs) {
    const actions = turnsPerHour * 0.2 * r.tier3Share;
    const execS = (actions * testSpec.actionMs) / 1000;
    const tailS = (actions / r.batch) * 60;
    const awakeS = Math.min(3600, execS + tailS);
    const duty = awakeS / 3600;
    const hours = agentHours * duty;
    const cpuBusy = awakeS > 0 ? (execS * testSpec.cpuBusy) / awakeS : 0;
    const cc = containerCost(LITE, hours, Math.max(0.05, cpuBusy));
    const total = BASE + cc.total + doCost(agentHours * 24);
    if (r.label.startsWith("D")) shipped = total;
    out.write(
      `  ${pad(r.label, 42)}${pad(execS.toFixed(0), 10)}${pad(awakeS.toFixed(0), 11)}${pad(
        `${(duty * 100).toFixed(1)}%`,
        9,
      )}${pad(hours.toFixed(0), 9)}${usd(total, 2)}\n`,
    );
  }

  out.write(`\n  ${c.dim("run A is the trap: the 60s sleep tail is charged after every test, so the")}\n`);
  out.write(`  ${c.dim("container never sleeps. awake 100% of the time to do 27% of a box's work.")}\n`);

  /* What it takes */
  const budgetS = (includedHours(LITE) / agentHours) * 3600;
  const perAction = testSpec.actionMs / 1000 + 60 / 8;
  const maxActions = budgetS / perAction;
  const maxTestShare = maxActions / 0.4 / turnsPerHour;

  out.write(`\n${c.bold("what it takes to reach $5")}\n\n`);
  out.write(`  budget           ${includedHours(LITE).toFixed(0)} container-hours / ${agentHours} agent-hours\n`);
  out.write(`  = ${budgetS.toFixed(0)} s of container wake time per agent-hour\n`);
  out.write(`  = ${maxActions.toFixed(2)} container-needing Tier-3 actions per agent-hour\n`);
  out.write(`  = a test share of ${c.bold(`${(maxTestShare * 100).toFixed(1)}%`)} of turns, down from 20%\n`);
  out.write(`\n  ${c.bold("verdict")} at 30/30/20/20 with 12s tests, ${agentHours.toLocaleString()} agent-hours does not fit $5.\n`);
  out.write(`  cheapest shipped config for that workload: ${c.bold(`${usd(shipped, 2)}/month`)}.\n`);
  out.write(`  ${c.dim("milo ships the overage, priced and visible, rather than hiding it. see COST_MODEL.md.")}\n`);

  /* The cliff */
  const freeDoSeconds = DO_DURATION_INCLUDED_GB_S / DO_BILLED_MEMORY_GIB;
  out.write(`\n${c.bold("durable objects: where the cliff is")}\n\n`);
  out.write(`  duration is free under ${DO_DURATION_INCLUDED_GB_S.toLocaleString()} GB-s = ${freeDoSeconds.toLocaleString()} DO-seconds.\n`);
  out.write(`  spread over ${agentHours} agent-hours that is ${c.bold(`${((freeDoSeconds / (agentHours * 3600)) * 100).toFixed(1)}%`)} duty per agent.\n`);
  out.write(`  cross it and billable GB-s round ${c.bold("up")} to 1,000,000 = ${c.red("+$12.50")}.\n`);
  out.write(`  ${c.dim("milo targets 24 DO-seconds per agent-hour = 0.7% duty. comfortably inside.")}\n`);

  return 0;
}
