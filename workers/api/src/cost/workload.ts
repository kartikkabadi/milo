/**
 * The load-test workload, as arithmetic.
 *
 * The stated mix is 30/30/20/20 think/read/edit/test. The thing that decides
 * the bill is not the *share of tasks*, it is the *share of wall-clock time
 * spent holding the container awake*. Those are wildly different numbers, and
 * conflating them is how people end up with a surprise invoice.
 *
 * So: model turns, not tasks. Each turn is one model call plus one action.
 * The model call happens in Tier 0 and costs nothing in container time. The
 * action determines the tier.
 */

export type TaskKind = "think" | "read" | "edit" | "test";

export interface TaskSpec {
  kind: TaskKind;
  /** Share of turns that take this action. The four shares sum to 1. */
  share: number;
  /** Tier that serves this action. Only tier 3 wakes the container. */
  tier: 0 | 1 | 2 | 3;
  /** Wall-clock ms the action itself takes once the model has replied. */
  actionMs: number;
  /** vCPU busy fraction during the action, on the lite instance. */
  cpuBusy: number;
  note: string;
}

export const TASK_MIX: TaskSpec[] = [
  {
    kind: "think",
    share: 0.3,
    tier: 0,
    actionMs: 250,
    cpuBusy: 0.02,
    note: "AI Gateway call from the DO. No container, no filesystem.",
  },
  {
    kind: "read",
    share: 0.3,
    tier: 1,
    actionMs: 400,
    cpuBusy: 0.05,
    note: "DO SQLite index + R2 blob read, coarse file ops in one RPC.",
  },
  {
    kind: "edit",
    share: 0.2,
    tier: 2,
    actionMs: 600,
    cpuBusy: 0.05,
    note: "Patch assembled in the DO, applied with git apply. Still no container.",
  },
  {
    kind: "test",
    share: 0.2,
    tier: 3,
    actionMs: 12_000,
    cpuBusy: 0.85,
    note: "The only action that needs a real filesystem. 12s is a small suite.",
  },
];

export interface WorkloadInput {
  agents: number;
  agentHours: number;
  /** Wall-clock ms of model latency per turn. Dominates the agent-hour. */
  modelLatencyMs: number;
  /**
   * Fraction of `test` actions that genuinely need a container.
   * The rest are pure-JS suites that run in a Dynamic Worker isolate (Tier 2)
   * for free. Deleting the container from these is the single biggest lever.
   */
  tier3Share: number;
  /** Container sleep tail, ms. The floor is 60s. */
  sleepTailMs: number;
  /** How many Tier-3 actions are accumulated into one container wake. */
  batchSize: number;
}

export interface WorkloadResult {
  input: WorkloadInput;
  turnsPerAgentHour: number;
  /** Tier-3 actions per agent-hour, before and after isolate offload. */
  tier3ActionsPerAgentHour: number;
  tier3ActionsNeedingContainer: number;
  /** Seconds per agent-hour spent executing inside the container. */
  containerExecSecondsPerAgentHour: number;
  wakesPerAgentHour: number;
  containerAwakeSecondsPerAgentHour: number;
  /** Fraction of agent-hours the container instance is awake. Capped at 1. */
  tier3Duty: number;
  containerSaturated: boolean;
  /** vCPU busy fraction across the awake time. */
  cpuBusyFraction: number;
  containerHours: number;
  /** Idiot index for the sleep tail alone. */
  tailIdiotIndex: number;
  lines: string[];
}

export function simulateWorkload(input: WorkloadInput): WorkloadResult {
  const actionMsAvg = TASK_MIX.reduce((a, t) => a + t.share * t.actionMs, 0);
  const turnMs = input.modelLatencyMs + actionMsAvg;
  const turnsPerAgentHour = 3_600_000 / turnMs;

  const testSpec = TASK_MIX.find((t) => t.kind === "test")!;
  const tier3ActionsPerAgentHour = turnsPerAgentHour * testSpec.share;
  const tier3ActionsNeedingContainer = tier3ActionsPerAgentHour * input.tier3Share;

  const containerExecSecondsPerAgentHour = (tier3ActionsNeedingContainer * testSpec.actionMs) / 1000;

  const batch = Math.max(1, input.batchSize);
  const wakesPerAgentHour = tier3ActionsNeedingContainer / batch;
  const tailSeconds = wakesPerAgentHour * (input.sleepTailMs / 1000);

  const rawAwake = containerExecSecondsPerAgentHour + tailSeconds;
  const containerSaturated = rawAwake >= 3600;
  const containerAwakeSecondsPerAgentHour = Math.min(3600, rawAwake);

  const tier3Duty = containerAwakeSecondsPerAgentHour / 3600;

  // CPU busy across awake time: tier-3 exec is busy, the sleep tail is idle.
  const busySeconds = containerExecSecondsPerAgentHour * testSpec.cpuBusy;
  const cpuBusyFraction = containerAwakeSecondsPerAgentHour > 0 ? busySeconds / containerAwakeSecondsPerAgentHour : 0;

  const tailIdiotIndex =
    containerExecSecondsPerAgentHour > 0 ? containerAwakeSecondsPerAgentHour / containerExecSecondsPerAgentHour : 0;

  return {
    input,
    turnsPerAgentHour,
    tier3ActionsPerAgentHour,
    tier3ActionsNeedingContainer,
    containerExecSecondsPerAgentHour,
    wakesPerAgentHour,
    containerAwakeSecondsPerAgentHour,
    tier3Duty,
    containerSaturated,
    cpuBusyFraction,
    containerHours: input.agentHours * tier3Duty,
    tailIdiotIndex,
    lines: [
      `model latency ${input.modelLatencyMs} ms + avg action ${actionMsAvg.toFixed(0)} ms = ${turnMs.toFixed(0)} ms per turn`,
      `${turnsPerAgentHour.toFixed(1)} turns per agent-hour`,
      `tier-3 actions: ${tier3ActionsPerAgentHour.toFixed(1)}/h, of which ${tier3ActionsNeedingContainer.toFixed(1)}/h need a container`,
      `container exec: ${containerExecSecondsPerAgentHour.toFixed(1)} s per agent-hour`,
      `wakes: ${wakesPerAgentHour.toFixed(2)}/h, tail costs ${tailSeconds.toFixed(1)} s per agent-hour`,
      `awake: ${containerAwakeSecondsPerAgentHour.toFixed(1)} s per agent-hour -> duty ${(tier3Duty * 100).toFixed(2)}%`,
      containerSaturated
        ? `CONTAINER SATURATED: the 60s tail alone exceeds the hour. The container never sleeps.`
        : `tail idiot index ${tailIdiotIndex.toFixed(2)}x`,
    ],
  };
}

/**
 * The largest number of container-needing Tier-3 actions per agent-hour that
 * fits inside the included container-hours. Everything above this is overage.
 */
export function maxContainerActionsPerAgentHour(opts: {
  freeContainerHours: number;
  agentHours: number;
  actionMs: number;
  sleepTailMs: number;
  batchSize: number;
}): number {
  const awakeBudgetSeconds = (opts.freeContainerHours / opts.agentHours) * 3600;
  const perAction = opts.actionMs / 1000 + opts.sleepTailMs / 1000 / Math.max(1, opts.batchSize);
  return awakeBudgetSeconds / perAction;
}

/** What the workload would have to look like to fit the $5 base plan. */
export function basePlanRequirement(opts: {
  freeContainerHours: number;
  agentHours: number;
  sleepTailMs: number;
  batchSize: number;
  tier3Share: number;
}): {
  maxContainerActionsPerAgentHour: number;
  maxTestShare: number;
  currentTestShare: number;
  verdict: string;
} {
  const testSpec = TASK_MIX.find((t) => t.kind === "test")!;
  const maxActions = maxContainerActionsPerAgentHour({
    freeContainerHours: opts.freeContainerHours,
    agentHours: opts.agentHours,
    actionMs: testSpec.actionMs,
    sleepTailMs: opts.sleepTailMs,
    batchSize: opts.batchSize,
  });
  const turnsPerAgentHour = 3_600_000 / (6000 + TASK_MIX.reduce((a, t) => a + t.share * t.actionMs, 0));
  const maxTestShare = maxActions / opts.tier3Share / turnsPerAgentHour;

  return {
    maxContainerActionsPerAgentHour: maxActions,
    maxTestShare,
    currentTestShare: testSpec.share,
    verdict:
      maxTestShare < testSpec.share
        ? `To fit $5 the test share must fall from ${(testSpec.share * 100).toFixed(0)}% to ${(maxTestShare * 100).toFixed(1)}% of turns.`
        : `The stated mix already fits $5 at this configuration.`,
  };
}
