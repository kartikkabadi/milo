/**
 * The idiot index, applied to Milo's own resource consumption.
 *
 *   idiot index = resources actually consumed / theoretical minimum needed
 *
 * Anything above 10x is flagged. The three worst offenders are surfaced in
 * the GUI's cost ledger, because a cost panel that only shows totals hides
 * exactly the thing you need to see: which decision is 30x wrong.
 *
 * "Theoretical minimum for useful exec" is defined narrowly on purpose. It is
 * the resource cost of the work that produced a useful result — not the cost
 * of being ready to do it, not the cost of the tail after it, not the cost of
 * provisioned-but-unused memory.
 */

export interface IdiotIndexInput {
  id: string;
  label: string;
  /** What was actually consumed, in the dimension's native unit. */
  actual: number;
  /** The floor for the useful work performed, same unit. */
  theoretical: number;
  unit: string;
  /** What to do about it. One sentence, imperative. */
  remedy: string;
}

export interface IdiotIndexResult extends IdiotIndexInput {
  index: number;
  flagged: boolean;
}

export const FLAG_THRESHOLD = 10;

export function idiotIndex(input: IdiotIndexInput): IdiotIndexResult {
  const index = input.theoretical > 0 ? input.actual / input.theoretical : Number.POSITIVE_INFINITY;
  return { ...input, index, flagged: index > FLAG_THRESHOLD };
}

/** Ranks by index descending and returns the worst N. */
export function worstIndices(results: IdiotIndexResult[], n = 3): IdiotIndexResult[] {
  return [...results].sort((a, b) => b.index - a.index).slice(0, n);
}

/* ------------------------------------------------------------------ *
 * The four indices Milo actually tracks.
 * ------------------------------------------------------------------ */

export interface IndexContext {
  containerHours: number;
  execSeconds: number;
  sleepTailSeconds: number;
  provisionedMemoryGiB: number;
  peakWorkingSetGiB: number;
  doSeconds: number;
  doUsefulSeconds: number;
  r2BytesWritten: number;
  r2BytesNeeded: number;
  doRowsRead: number;
  doRowsNeeded: number;
}

export function miloIndices(ctx: IndexContext): IdiotIndexResult[] {
  const results: IdiotIndexResult[] = [];

  // 1. The container itself. Provisioned memory is billed whether used or not,
  //    so a 256 MiB box running an 80 MiB working set is a 3.2x by construction.
  results.push(
    idiotIndex({
      id: "container-memory",
      label: "Container memory: provisioned vs working set",
      actual: ctx.provisionedMemoryGiB,
      theoretical: ctx.peakWorkingSetGiB,
      unit: "GiB",
      remedy:
        "Lite is already the smallest box. If the working set is far below 256 MiB the only fix is fewer awake hours, not a smaller instance.",
    }),
  );

  // 2. The sleep tail. 60s of idle billing after a 12s test is 6x before you
  //    even count the container's own overhead.
  results.push(
    idiotIndex({
      id: "sleep-tail",
      label: "Container awake time vs useful exec time",
      actual: ctx.execSeconds + ctx.sleepTailSeconds,
      theoretical: ctx.execSeconds,
      unit: "s",
      remedy: "Batch Tier-3 calls so one wake serves many execs. Six tests per wake turns 6x into 1.8x.",
    }),
  );

  // 3. Durable Object duration. A DO bills 128 MiB for every second it is
  //    awake, including the seconds it spends waiting on I/O.
  results.push(
    idiotIndex({
      id: "do-duration",
      label: "DO awake time vs time spent executing",
      actual: ctx.doSeconds,
      theoretical: ctx.doUsefulSeconds,
      unit: "s",
      remedy:
        "Do not hold the DO awake across a container call. Await the sandbox from a fiber and let the DO hibernate.",
    }),
  );

  // 4. Snapshot bytes. If a snapshot is bigger than the diff it protects,
  //    the snapshot strategy is wrong.
  results.push(
    idiotIndex({
      id: "snapshot-bytes",
      label: "Snapshot bytes written vs bytes that changed",
      actual: ctx.r2BytesWritten,
      theoretical: ctx.r2BytesNeeded,
      unit: "bytes",
      remedy: "Prefer the patch snapshot. A bundle is only for the case where history was rewritten.",
    }),
  );

  // 5. DO rows read. A full scan per keystroke is how a cheap control plane
  //    becomes an expensive database.
  results.push(
    idiotIndex({
      id: "do-rows",
      label: "DO rows read vs rows needed",
      actual: ctx.doRowsRead,
      theoretical: ctx.doRowsNeeded,
      unit: "rows",
      remedy: "Index the lookup. A timeline render must not scan the event table.",
    }),
  );

  return results;
}
