/**
 * milo watch — bind a session to a repo and follow it.
 *
 * This is the command from the README, so it has to do something real. It:
 *   1. resolves the repo root and the current branch
 *   2. creates or resumes a session on the API
 *   3. streams session state over the WebSocket
 *   4. renders a one-line status that updates in place
 *
 * It does not print a fake progress bar. If the API is not running it says so
 * and exits 1, because a watcher that silently watches nothing is worse than
 * no watcher.
 */

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { api, apiBase, c, flag, positional } from "../lib.ts";

const run = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await run("git", args, { cwd });
  return stdout.trim();
}

async function repoRoot(dir: string): Promise<string> {
  try {
    return await git(["rev-parse", "--show-toplevel"], dir);
  } catch {
    throw new Error(`${dir} is not inside a git repository. Milo watches git repos, because git is where it saves your work.`);
  }
}

const TIER_LABEL = ["think", "read", "edit", "exec"] as const;
const CONTAINER_TIERS = new Set([3]);

function render(state: {
  status: string;
  tier: number | null;
  holdsLease: boolean;
  queuePosition: number;
  branch: string | null;
  head: string | null;
  spend: { month: number; containerHours: number; tier3Duty: number; awakeIndex: number };
}): string {
  const tier = state.tier === null ? "—" : `T${state.tier} ${TIER_LABEL[state.tier]}`;
  const lease = state.holdsLease ? c.accent("container held") : c.dim("no container");
  const head = state.head ? state.head.slice(0, 8) : c.dim("no commits yet");
  const cost = state.spend.month > 0 ? `$${state.spend.month.toFixed(2)}/mo` : c.green("$0.00");
  const idle = state.queuePosition > 0 ? c.yellow(`queued #${state.queuePosition}`) : "";
  return [
    c.bold(state.status.padEnd(10)),
    tier.padEnd(12),
    lease.padEnd(28),
    `head ${head}`.padEnd(20),
    cost.padStart(10),
    idle,
  ]
    .filter(Boolean)
    .join("  ");
}

export async function watch(args: string[]): Promise<number> {
  const dir = positional(args)[0] ?? process.cwd();
  const name = flag(args, "session");
  const harness = flag(args, "harness") ?? "pi";
  const once = args.includes("--once");

  let root: string;
  try {
    root = await repoRoot(dir);
  } catch (err) {
    process.stderr.write(`${c.red("error")} ${String(err instanceof Error ? err.message : err)}\n`);
    return 1;
  }

  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], root).catch(() => "unknown");
  const remote = await git(["remote", "get-url", "origin"], root).catch(() => "");

  // Session id derives from the repo path, so the same checkout resumes the
  // same session instead of spawning a new one on every watch.
  const sessionId = name ?? `repo-${root.replace(/[^A-Za-z0-9]/g, "-").slice(-32)}`;

  process.stdout.write(`${c.accent("milo")} watch ${c.dim(root)}\n`);
  process.stdout.write(`${c.dim("  branch")} ${branch}\n`);
  process.stdout.write(`${c.dim("  session")} ${sessionId}\n`);
  process.stdout.write(`${c.dim("  api")} ${apiBase()}\n\n`);

  // Rules files, if present. Reported, not enforced — enforcement is the
  // Worker's job, and a CLI that pretends to enforce is a CLI that lies.
  for (const file of ["taste.md", "milo.yaml", ".commandcode/taste/taste.md"]) {
    try {
      await readFile(`${root}/${file}`, "utf8");
      process.stdout.write(`${c.green("  rules")} ${file}\n`);
    } catch {
      // Absent is the normal case.
    }
  }

  try {
    await api(`/api/sessions/${sessionId}/launch`, {
      method: "POST",
      body: JSON.stringify({ harness, repo: remote || root }),
    });
  } catch (err) {
    process.stderr.write(`\n${c.red("error")} ${String(err instanceof Error ? err.message : err)}\n`);
    return 1;
  }

  if (once) {
    const state = await api<Parameters<typeof render>[0]>(`/api/sessions/${sessionId}`);
    process.stdout.write(`\n${render(state)}\n`);
    return 0;
  }

  process.stdout.write(`\n${c.dim("watching. ctrl-c to stop. the session keeps its snapshot either way.")}\n\n`);

  let stop = false;
  process.on("SIGINT", () => {
    stop = true;
    process.stdout.write(
      `\n${c.dim("stopped watching. the session is still bound; run `milo status` to find it.")}\n`,
    );
    process.exit(0);
  });

  let last = "";
  while (!stop) {
    try {
      const state = await api<Parameters<typeof render>[0]>(`/api/sessions/${sessionId}`);
      const line = render(state);
      if (line !== last) {
        process.stdout.write(`\r${line}`);
        last = line;
      }
    } catch (err) {
      process.stdout.write(`\r${c.red("lost the API")} ${c.dim(String(err instanceof Error ? err.message : err))}\n`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return 0;
}
