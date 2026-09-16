/** milo status / sleep / wake — session control against the API. */

import { api, c, positional } from "../lib.ts";

interface SessionState {
  ok?: boolean;
  sessionId?: string;
  status?: string;
  tier?: number | null;
  holdsLease?: boolean;
  queuePosition?: number;
  head?: string | null;
  branch?: string | null;
  lastError?: string | null;
  spend?: { month: number; containerHours: number; tier3Duty: number; awakeIndex: number };
}

interface CostResponse {
  summary: {
    containerHours: number;
    doSeconds: number;
    doRequests: number;
    actions: number;
    usd: { base: number; containers: number; total: number };
    awakeIndex: number;
    byTier: Record<string, { actions: number; containerHours: number }>;
  };
  worst: { label: string; index: number; flagged: boolean; remedy: string }[];
}

const TIER_LABEL = ["think", "read", "edit", "exec"] as const;

function sessionId(args: string[]): string {
  const id = positional(args)[0];
  if (!id) {
    process.stderr.write(
      `${c.red("error")} a session id is required.\n  Try \`milo watch\` first, or \`milo status <session-id>\`.\n`,
    );
    process.exit(2);
  }
  return id;
}

export async function status(args: string[]): Promise<number> {
  const id = sessionId(args);
  const state = await api<SessionState>(`/api/sessions/${id}`);
  const cost = await api<CostResponse>(`/api/sessions/${id}/cost`).catch(() => null);

  process.stdout.write(`${c.bold(id)}\n`);
  process.stdout.write(`  status       ${state.status ?? "unknown"}\n`);
  process.stdout.write(`  tier         ${state.tier === null || state.tier === undefined ? "—" : `T${state.tier} ${TIER_LABEL[state.tier]}`}\n`);
  process.stdout.write(`  container    ${state.holdsLease ? c.accent("held") : c.dim("none")}\n`);
  if (state.queuePosition) {
    process.stdout.write(`  queue        ${c.yellow("#" + state.queuePosition)}\n`);
  }
  process.stdout.write(`  branch       ${state.branch ?? "—"}\n`);
  process.stdout.write(`  head         ${state.head?.slice(0, 8) ?? c.dim("no commits yet")}\n`);
  if (state.lastError) process.stdout.write(`  ${c.red("last error")}   ${state.lastError}\n`);

  if (cost) {
    const s = cost.summary;
    process.stdout.write(`\n  ${c.dim("this month")}\n`);
    process.stdout.write(`  container    ${s.containerHours.toFixed(2)} h of 100 included\n`);
    process.stdout.write(`  awake/exec   ${s.awakeIndex.toFixed(2)}x\n`);
    process.stdout.write(`  actions      ${s.actions}\n`);
    for (const [tier, row] of Object.entries(s.byTier)) {
      process.stdout.write(`  tier ${tier}       ${row.actions} actions, ${row.containerHours.toFixed(2)} h\n`);
    }
    process.stdout.write(`  total        ${c.bold(`$${s.usd.total.toFixed(2)}/mo`)} (base $${s.usd.base.toFixed(2)})\n`);
    if (cost.worst.length) {
      process.stdout.write(`\n  ${c.dim("worst idiot indices")}\n`);
      for (const ix of cost.worst) {
        const mark = ix.flagged ? c.red(`${ix.index.toFixed(2)}x`) : `${ix.index.toFixed(2)}x`;
        process.stdout.write(`  ${mark.padEnd(20)} ${ix.label}\n`);
        if (ix.flagged) process.stdout.write(`    ${c.dim(ix.remedy)}\n`);
      }
    }
  }
  return 0;
}

export async function sleep(args: string[]): Promise<number> {
  const id = sessionId(args);
  const res = await api<{ sha: string | null; log: string[] }>(`/api/sessions/${id}/sleep`, { method: "POST" });
  for (const line of res.log) process.stdout.write(`  ${c.dim(line)}\n`);
  process.stdout.write(
    res.sha
      ? `${c.green("slept")} snapshot at ${c.accent(res.sha.slice(0, 8))}. the container is released.\n`
      : `${c.green("slept")} nothing to snapshot. the container is released.\n`,
  );
  return 0;
}

export async function wake(args: string[]): Promise<number> {
  const id = sessionId(args);
  const res = await api<{ restored: boolean; sha: string | null; log: string[] }>(`/api/sessions/${id}/wake`, { method: "POST" });
  for (const line of res.log) process.stdout.write(`  ${c.dim(line)}\n`);
  process.stdout.write(
    res.restored
      ? `${c.green("woke")} restored to ${c.accent(res.sha?.slice(0, 8) ?? "unknown")}\n`
      : `${c.yellow("woke")} nothing to restore. starting clean.\n`,
  );
  return 0;
}
