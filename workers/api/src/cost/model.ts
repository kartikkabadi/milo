/**
 * The cost model.
 *
 * Every function here is pure arithmetic over the rates in `rates.ts`. No
 * bindings, no network. That means `npm run cost` reproduces the numbers in
 * COST_MODEL.md on any machine, and a reviewer can check the arithmetic
 * instead of trusting it.
 *
 * The one idea that matters: an *agent-hour* is not a *container-hour*.
 * An agent is "on shift" for 3,000 hours a month. A container only has to be
 * awake while Tier-3 work is executing. Everything else runs in the Durable
 * Object or the Worker, which sit inside included allotments. The whole cost
 * question reduces to: what fraction of agent-hours needs the container?
 */

import {
  CONTAINERS,
  DURABLE_OBJECTS,
  INSTANCE_TYPES,
  PLAN_BASE_USD,
  R2,
  SECONDS_PER_HOUR,
  WORKERS,
  type InstanceType,
} from "./rates.ts";

export interface Usd {
  usd: number;
  detail: string;
}

const money = (usd: number): string => `$${usd.toFixed(4)}`;

/** Cloudflare rounds billable usage UP to the next billable unit. */
export function roundUpToUnit(value: number, unit: number): number {
  if (value <= 0) return 0;
  return Math.ceil(value / unit) * unit;
}

/* ------------------------------------------------------------------ *
 * Containers
 * ------------------------------------------------------------------ */

/**
 * How many container-hours fit inside the included Containers allotment for
 * an instance type.
 *
 * Memory and disk bill on provisioned size, so both bound the free hours.
 * CPU is billed on active usage, so it bounds free hours only at saturation;
 * a mostly-idle container stretches its CPU inclusion much further. We return
 * the memory/disk bound, which is the one you cannot dodge.
 *
 * For `lite` this is 100 hours: 25 GiB-h / 0.25 GiB, and 200 GB-h / 2 GB.
 * Both land on exactly 100. That coincidence is why lite is the right box.
 */
export function includedContainerHours(instance: InstanceType): {
  hours: number;
  boundBy: "memory" | "disk";
  memoryHours: number;
  diskHours: number;
} {
  const memoryGiB = instance.memoryMiB / 1024;
  const memoryHours = CONTAINERS.memoryIncludedGiBH / memoryGiB;
  const diskHours = CONTAINERS.diskIncludedGbH / instance.diskGb;
  const boundBy = memoryHours <= diskHours ? "memory" : "disk";
  return {
    hours: Math.min(memoryHours, diskHours),
    boundBy,
    memoryHours,
    diskHours,
  };
}

export interface ContainerCostInput {
  instance: InstanceType;
  /** Wall-clock hours the container instance is awake and billing. */
  containerHours: number;
  /**
   * Fraction of awake time the vCPU is actually busy, 0..1.
   * CPU is the only dimension billed on usage rather than provisioned size.
   */
  cpuBusyFraction: number;
}

export interface ContainerCost extends Usd {
  memory: Usd;
  disk: Usd;
  cpu: Usd;
  billableHours: number;
  includedHours: number;
  memoryGiBS: number;
  diskGbS: number;
  cpuVcpuS: number;
  breakdown: string[];
}

export function containerCost(input: ContainerCostInput): ContainerCost {
  const { instance, containerHours, cpuBusyFraction } = input;
  const inc = includedContainerHours(instance);
  const billableHours = Math.max(0, containerHours - inc.hours);

  const memoryGiBS = billableHours * (instance.memoryMiB / 1024) * SECONDS_PER_HOUR;
  const memoryUsd = memoryGiBS * CONTAINERS.memoryPerGiBS;

  const diskGbS = billableHours * instance.diskGb * SECONDS_PER_HOUR;
  const diskUsd = diskGbS * CONTAINERS.diskPerGbS;

  const cpuVcpuS = containerHours * instance.vcpu * cpuBusyFraction * SECONDS_PER_HOUR;
  const cpuIncludedVcpuS = CONTAINERS.cpuIncludedVcpuMin * 60;
  const cpuUsd = Math.max(0, cpuVcpuS - cpuIncludedVcpuS) * CONTAINERS.cpuPerVcpuS;

  const usd = memoryUsd + diskUsd + cpuUsd;

  return {
    usd,
    detail: money(usd),
    memory: { usd: memoryUsd, detail: money(memoryUsd) },
    disk: { usd: diskUsd, detail: money(diskUsd) },
    cpu: { usd: cpuUsd, detail: money(cpuUsd) },
    billableHours,
    includedHours: inc.hours,
    memoryGiBS,
    diskGbS,
    cpuVcpuS,
    breakdown: [
      `included: ${inc.hours.toFixed(2)} h (bound by ${inc.boundBy}; memory ${inc.memoryHours.toFixed(1)} h, disk ${inc.diskHours.toFixed(1)} h)`,
      `billable: ${billableHours.toFixed(1)} h`,
      `memory: ${memoryGiBS.toFixed(0)} GiB-s x $${CONTAINERS.memoryPerGiBS} = ${money(memoryUsd)}`,
      `disk:   ${diskGbS.toFixed(0)} GB-s x $${CONTAINERS.diskPerGbS} = ${money(diskUsd)}`,
      `cpu:    ${cpuVcpuS.toFixed(0)} vCPU-s - ${cpuIncludedVcpuS} included = ${money(cpuUsd)}`,
    ],
  };
}

/**
 * The largest number of container-hours that fits a given monthly overage
 * budget. Solves the memory term, which is the binding one.
 */
export function maxContainerHoursForBudget(
  budgetUsd: number,
  instance: InstanceType,
  cpuBusyFraction = 0.85,
): number {
  const inc = includedContainerHours(instance);
  let lo = inc.hours;
  let hi = inc.hours + 10_000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const cost = containerCost({ instance, containerHours: mid, cpuBusyFraction }).usd;
    if (cost <= budgetUsd) lo = mid;
    else hi = mid;
  }
  return lo;
}

/* ------------------------------------------------------------------ *
 * Durable Objects
 * ------------------------------------------------------------------ */

export interface DoCostInput {
  /** Total wall-clock seconds every DO in the fleet was awake and not hibernating. */
  doSeconds: number;
  /** Billable requests: HTTP + RPC sessions + alarms + (WS messages / 20). */
  requests: number;
  rowsRead?: number;
  rowsWritten?: number;
  storageGbMonth?: number;
}

export interface DoCost extends Usd {
  duration: Usd;
  requests: Usd;
  rows: Usd;
  storage: Usd;
  doGiBS: number;
  breakdown: string[];
}

export function durableObjectCost(input: DoCostInput): DoCost {
  const doGiBS = input.doSeconds * DURABLE_OBJECTS.billedMemoryGiB;
  const billableGiBS = Math.max(0, doGiBS - DURABLE_OBJECTS.durationIncludedGiBS);
  // Rounded up to the next million GB-s before the rate applies.
  const chargedGiBS = roundUpToUnit(billableGiBS, 1_000_000);
  const durationUsd = (chargedGiBS / 1_000_000) * DURABLE_OBJECTS.durationPerMillionGiBS;

  const billableReq = Math.max(0, input.requests - DURABLE_OBJECTS.requestsIncluded);
  const chargedReq = roundUpToUnit(billableReq, 1_000_000);
  const requestsUsd = (chargedReq / 1_000_000) * DURABLE_OBJECTS.requestsPerMillion;

  const rowsRead = input.rowsRead ?? 0;
  const rowsWritten = input.rowsWritten ?? 0;
  const readUsd =
    (roundUpToUnit(Math.max(0, rowsRead - DURABLE_OBJECTS.rowsReadIncluded), 1_000_000) / 1_000_000) *
    DURABLE_OBJECTS.rowsReadPerMillion;
  const writeUsd =
    (roundUpToUnit(Math.max(0, rowsWritten - DURABLE_OBJECTS.rowsWrittenIncluded), 1_000_000) / 1_000_000) *
    DURABLE_OBJECTS.rowsWrittenPerMillion;
  const rowsUsd = readUsd + writeUsd;

  const storageGb = input.storageGbMonth ?? 0;
  const storageUsd =
    Math.max(0, storageGb - DURABLE_OBJECTS.storageIncludedGbMonth) * DURABLE_OBJECTS.storagePerGbMonth;

  const usd = durationUsd + requestsUsd + rowsUsd + storageUsd;

  return {
    usd,
    detail: money(usd),
    duration: { usd: durationUsd, detail: money(durationUsd) },
    requests: { usd: requestsUsd, detail: money(requestsUsd) },
    rows: { usd: rowsUsd, detail: money(rowsUsd) },
    storage: { usd: storageUsd, detail: money(storageUsd) },
    doGiBS,
    breakdown: [
      `duration: ${doGiBS.toFixed(0)} GB-s (${DURABLE_OBJECTS.billedMemoryGiB} GiB x ${input.doSeconds.toFixed(0)} s)`,
      `  included ${DURABLE_OBJECTS.durationIncludedGiBS} GB-s, billable ${billableGiBS.toFixed(0)}, rounded up to ${chargedGiBS} -> ${money(durationUsd)}`,
      `requests: ${input.requests.toFixed(0)}, billable ${billableReq.toFixed(0)}, rounded up to ${chargedReq} -> ${money(requestsUsd)}`,
      `rows+storage -> ${money(rowsUsd + storageUsd)}`,
    ],
  };
}

/**
 * The DO duty cycle at which duration billing starts. Above this, the
 * $12.50 million-GB-s increment lands and the bill jumps.
 *
 * 400,000 GB-s / 0.128 GiB = 3,125,000 DO-seconds of headroom. Spread over
 * 3,000 agent-hours that is 1,041 DO-seconds per agent-hour, or 28.9% duty.
 */
export function doDurationFreeDutyCycle(agentHours: number): number {
  const freeDoSeconds = DURABLE_OBJECTS.durationIncludedGiBS / DURABLE_OBJECTS.billedMemoryGiB;
  return freeDoSeconds / (agentHours * SECONDS_PER_HOUR);
}

/* ------------------------------------------------------------------ *
 * Workers and R2
 * ------------------------------------------------------------------ */

export function workersCost(requests: number, cpuMs: number): Usd {
  const reqUsd =
    (roundUpToUnit(Math.max(0, requests - WORKERS.requestsIncluded), 1_000_000) / 1_000_000) *
    WORKERS.requestsPerMillion;
  const cpuUsd =
    (roundUpToUnit(Math.max(0, cpuMs - WORKERS.cpuMsIncluded), 1_000_000) / 1_000_000) *
    WORKERS.cpuMsPerMillion;
  const usd = reqUsd + cpuUsd;
  return { usd, detail: money(usd) };
}

export function r2Cost(classA: number, classB: number, storageGbMonth: number): Usd {
  const aUsd = (Math.max(0, classA - R2.freeClassA) / 1_000_000) * R2.classAPerMillion;
  const bUsd = (Math.max(0, classB - R2.freeClassB) / 1_000_000) * R2.classBPerMillion;
  const sUsd = Math.max(0, storageGbMonth - R2.freeStorageGbMonth) * R2.storagePerGbMonth;
  const usd = aUsd + bUsd + sUsd;
  return { usd, detail: money(usd) };
}

/* ------------------------------------------------------------------ *
 * Whole scenario
 * ------------------------------------------------------------------ */

export interface Scenario {
  name: string;
  note: string;
  instanceType: string;
  agentHours: number;
  /** Fraction of agent-hours the container instance is awake. */
  tier3Duty: number;
  /** vCPU busy fraction while the container is awake. */
  cpuBusyFraction: number;
  /** DO wall-clock seconds per agent-hour that are not hibernating. */
  doSecondsPerAgentHour: number;
  /** Billable DO requests for the whole fleet for the month. */
  doRequests: number;
  r2ClassA: number;
  r2ClassB: number;
  r2StorageGbMonth: number;
  workerRequests: number;
  workerCpuMs: number;
}

export interface PricedScenario {
  scenario: Scenario;
  containerHours: number;
  container: ContainerCost;
  durableObjects: DoCost;
  workers: Usd;
  r2: Usd;
  base: number;
  overage: number;
  total: number;
  totalDetail: string;
}

export function priceScenario(s: Scenario): PricedScenario {
  const instance = INSTANCE_TYPES[s.instanceType];
  if (!instance) throw new Error(`unknown instance type: ${s.instanceType}`);

  const containerHours = s.agentHours * s.tier3Duty;
  const container = containerCost({
    instance,
    containerHours,
    cpuBusyFraction: s.cpuBusyFraction,
  });
  const durableObjects = durableObjectCost({
    doSeconds: s.agentHours * s.doSecondsPerAgentHour,
    requests: s.doRequests,
  });
  const workers = workersCost(s.workerRequests, s.workerCpuMs);
  const r2 = r2Cost(s.r2ClassA, s.r2ClassB, s.r2StorageGbMonth);

  const overage = container.usd + durableObjects.usd + workers.usd + r2.usd;
  const total = PLAN_BASE_USD + overage;

  return {
    scenario: s,
    containerHours,
    container,
    durableObjects,
    workers,
    r2,
    base: PLAN_BASE_USD,
    overage,
    total,
    totalDetail: money(total),
  };
}

/**
 * The cheapest shipped configuration for a workload.
 *
 * Returns the duty cycle the workload actually needs, and the duty cycle the
 * $5 base can absorb, so the gap is explicit rather than hidden behind an
 * average.
 */
export function cheapestConfig(opts: {
  agentHours: number;
  tier3Duty: number;
  cpuBusyFraction: number;
}): {
  priced: PricedScenario;
  freeDutyCycle: number;
  fitsBasePlan: boolean;
  gapHours: number;
  levers: string[];
} {
  const instance = INSTANCE_TYPES.lite;
  const inc = includedContainerHours(instance);
  const freeDutyCycle = inc.hours / opts.agentHours;

  const priced = priceScenario({
    name: "cheapest-shipped",
    note: "lite + max_instances 1 + sleepAfter 60s + no keepAlive",
    instanceType: "lite",
    agentHours: opts.agentHours,
    tier3Duty: opts.tier3Duty,
    cpuBusyFraction: opts.cpuBusyFraction,
    doSecondsPerAgentHour: 24,
    doRequests: 600_000,
    r2ClassA: 60_000,
    r2ClassB: 120_000,
    r2StorageGbMonth: 2,
    workerRequests: 400_000,
    workerCpuMs: 2_000_000,
  });

  const containerHours = opts.agentHours * opts.tier3Duty;
  const gapHours = Math.max(0, containerHours - inc.hours);

  const levers: string[] = [];
  if (gapHours > 0) {
    levers.push(
      `Move Tier-3 work that does not need a filesystem into a Dynamic Worker isolate (Tier 2). Pure-JS unit tests do not need a container.`,
    );
    levers.push(
      `Batch Tier-3 calls into fewer, longer wakes. A 60s sleep tail amortised over one 12s test is a 6x idiot index; over six tests it is 1.8x.`,
    );
    levers.push(
      `Lower tier3Duty from ${(opts.tier3Duty * 100).toFixed(1)}% to ${(freeDutyCycle * 100).toFixed(2)}% to return to the $5 base. That is ${gapHours.toFixed(0)} container-hours to delete.`,
    );
    levers.push(`Do not raise max_instances. It multiplies the overage linearly.`);
    levers.push(`Do not set keepAlive. It is a 30x idiot index.`);
  }

  return {
    priced,
    freeDutyCycle,
    fitsBasePlan: gapHours === 0,
    gapHours,
    levers,
  };
}

export { PLAN_BASE_USD, INSTANCE_TYPES, includedContainerHours as _includedContainerHours };
