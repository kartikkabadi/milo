/**
 * Cloudflare rates, read from the live docs and hard-coded here on purpose.
 *
 * Why hard-coded: the cost ledger must be able to price a session with no
 * network call and no binding. A wrong rate produces a wrong ledger, so every
 * number below carries the URL it came from and the date it was read. If
 * Cloudflare changes a rate, change it here and nowhere else.
 *
 * Read 2026-09-16.
 */

export const RATES_SOURCE = {
  workers: "https://developers.cloudflare.com/workers/platform/pricing/",
  durableObjects: "https://developers.cloudflare.com/durable-objects/platform/pricing/",
  containers: "https://developers.cloudflare.com/containers/platform/pricing/",
  containersLimits: "https://developers.cloudflare.com/containers/platform/limits/",
  workersLimits: "https://developers.cloudflare.com/workers/platform/limits/",
  r2: "https://developers.cloudflare.com/r2/pricing/",
  sandbox: "https://developers.cloudflare.com/sandbox/platform/pricing/",
  readOn: "2026-09-16",
} as const;

/** The Workers Paid plan minimum. Everything else is overage on top. */
export const PLAN_BASE_USD = 5.0;

/* ------------------------------------------------------------------ *
 * Containers
 *
 * Billed every 10ms while actively running. Memory and disk bill on the
 * *provisioned* instance size, not on actual usage. CPU bills on active
 * usage only.
 * ------------------------------------------------------------------ */

export const CONTAINERS = {
  /** 25 GiB-hours/month included, then $0.0000025 per GiB-second. */
  memoryIncludedGiBH: 25,
  memoryPerGiBS: 0.0000025,
  /** 375 vCPU-minutes/month included, then $0.000020 per vCPU-second. */
  cpuIncludedVcpuMin: 375,
  cpuPerVcpuS: 0.00002,
  /** 200 GB-hours/month included, then $0.00000007 per GB-second. */
  diskIncludedGbH: 200,
  diskPerGbS: 0.00000007,
  /** Egress, North America & Europe. 1 TB/month included. */
  egressIncludedGb: 1024,
  egressPerGb: 0.025,
} as const;

export const SECONDS_PER_HOUR = 3600;

export interface InstanceType {
  id: string;
  /** vCPU as a fraction of one core. */
  vcpu: number;
  memoryMiB: number;
  diskGb: number;
  note: string;
}

/**
 * Containers instance types. Milo ships `lite`; the rest exist here so the
 * cost model can price the upgrade honestly instead of guessing.
 */
export const INSTANCE_TYPES: Record<string, InstanceType> = {
  lite: {
    id: "lite",
    vcpu: 1 / 16,
    memoryMiB: 256,
    diskGb: 2,
    note: "Milo default. Cheapest instance whose included allotment reaches 100 container-hours.",
  },
  basic: {
    id: "basic",
    vcpu: 1 / 4,
    memoryMiB: 1024,
    diskGb: 4,
    note: "Use only if a Tier-3 workload genuinely cannot fit in 256 MiB. 4x memory burn.",
  },
  "standard-1": {
    id: "standard-1",
    vcpu: 1 / 2,
    memoryMiB: 4096,
    diskGb: 8,
    note: "Heavy browser only, behind an approval and a kill timeout.",
  },
  "standard-2": { id: "standard-2", vcpu: 1, memoryMiB: 6144, diskGb: 12, note: "Not used by Milo." },
  "standard-3": { id: "standard-3", vcpu: 2, memoryMiB: 8192, diskGb: 16, note: "Not used by Milo." },
  "standard-4": { id: "standard-4", vcpu: 4, memoryMiB: 12288, diskGb: 20, note: "Not used by Milo." },
};

/* ------------------------------------------------------------------ *
 * Workers
 * ------------------------------------------------------------------ */

export const WORKERS = {
  requestsIncluded: 10_000_000,
  requestsPerMillion: 0.3,
  cpuMsIncluded: 30_000_000,
  cpuMsPerMillion: 0.02,
  /** Static asset requests are free and unlimited. */
  staticAssetsFree: true,
  /** Hard ceiling, Workers Paid. */
  maxCpuMsPerInvocation: 300_000,
  /** Wall-clock ceiling for cron / queue consumer / DO alarm invocations. */
  maxWallMsPerScheduledInvocation: 900_000,
  logsIncluded: 20_000_000,
  logsPerMillion: 0.6,
} as const;

/* ------------------------------------------------------------------ *
 * Durable Objects
 *
 * Duration bills wall-clock time while active and not eligible for
 * hibernation, always at the full 128 MB allocation regardless of usage.
 * Incoming WebSocket messages bill at a 20:1 ratio.
 * ------------------------------------------------------------------ */

export const DURABLE_OBJECTS = {
  /** Billed memory per active object, in GiB. Fixed at 128 MB. */
  billedMemoryGiB: 0.128,
  requestsIncluded: 1_000_000,
  requestsPerMillion: 0.15,
  /** Incoming WS messages are divided by this before being billed as requests. */
  wsMessageRatio: 20,
  durationIncludedGiBS: 400_000,
  /** Rounded UP to the next million before the rate applies. This is the cliff. */
  durationPerMillionGiBS: 12.5,
  rowsReadIncluded: 25_000_000_000,
  rowsReadPerMillion: 0.001,
  rowsWrittenIncluded: 50_000_000,
  rowsWrittenPerMillion: 1.0,
  storageIncludedGbMonth: 5,
  storagePerGbMonth: 0.2,
  /** Alarms are billed as a request each, and as one row written each. */
  alarmBilledAsRequest: true,
  alarmBilledAsRowWritten: true,
} as const;

/* ------------------------------------------------------------------ *
 * R2
 * ------------------------------------------------------------------ */

export const R2 = {
  freeStorageGbMonth: 10,
  storagePerGbMonth: 0.015,
  freeClassA: 1_000_000,
  classAPerMillion: 4.5,
  freeClassB: 10_000_000,
  classBPerMillion: 0.36,
  egressFree: true,
} as const;

/* ------------------------------------------------------------------ *
 * Queues — used only if you opt into the queue path. Milo does not by
 * default: the DO alarm covers scheduling for less.
 * ------------------------------------------------------------------ */

export const QUEUES = {
  operationsIncluded: 1_000_000,
  operationsPerMillion: 0.4,
  /** write + read + delete per delivered message. */
  operationsPerMessage: 3,
} as const;

/** The single numbers the cost model leans on, exported for tests and docs. */
export const HEADLINE = {
  /** 3,000 agent-hours/month is the stated target workload. */
  targetAgentHours: 3000,
  agents: 10,
  hoursPerAgentPerDay: 10,
  daysPerMonth: 30,
} as const;
