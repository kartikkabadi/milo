/**
 * Harness adapters.
 *
 * Pi and OpenCode are two separate tools. They do not share a config format,
 * a permission model, or a headless contract. The temptation is to build one
 * abstraction over both and lose what makes each useful. Milo does not do
 * that. It builds one small adapter per harness that exposes exactly what the
 * tier ladder needs: how to run it, which tiers it may run in, and how to
 * read its output.
 *
 * The tier rules are not advisory. `allowedTiers` is checked by the ladder
 * before a command is built, and a harness that is asked to do something
 * outside its tier list throws.
 */

import type { HarnessId, Tier } from "../env.ts";

export interface RunSpec {
  /** The command to execute. */
  command: string;
  args: string[];
  /** Working directory inside the sandbox. */
  cwd: string;
  /** Extra environment for this invocation only. */
  env: Record<string, string>;
  /** True when this invocation is allowed to modify the filesystem. */
  mutates: boolean;
  /** True when this invocation needs a real filesystem, so Tier 3. */
  needsFilesystem: boolean;
}

export interface HarnessAdapter {
  id: HarnessId;
  label: string;
  /** Tiers this harness may be invoked in. Anything else throws. */
  allowedTiers: Tier[];
  /** Theme file names this harness reads, per Milo theme id. */
  themeArg: (themeId: string) => string[];
  /** Build a non-interactive invocation for one prompt. */
  build(prompt: string, opts: BuildOpts): RunSpec;
  /** Parse a stdout line into a normalised event, or null if it is noise. */
  parse(line: string): HarnessEvent | null;
}

export interface BuildOpts {
  tier: Tier;
  /** Model id, provider-qualified. */
  model?: string;
  /** Session id, used for resuming. */
  sessionId?: string;
  /** Working directory. */
  cwd?: string;
}

export type HarnessEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool-start"; tool: string; args: unknown }
  | { type: "tool-end"; tool: string; ok: boolean }
  | { type: "message-end"; usage?: { inputTokens: number; outputTokens: number } }
  | { type: "session"; id: string }
  | { type: "error"; message: string };

/** Throw rather than silently downgrade. A silent downgrade is a security bug. */
function assertTier(adapter: HarnessAdapter, tier: Tier): void {
  if (!adapter.allowedTiers.includes(tier)) {
    throw new Error(
      `${adapter.label} may not run in Tier ${tier}. Allowed: ${adapter.allowedTiers.join(", ")}. ` +
        `Lower tiers cannot boot a container, and higher tiers are the only place a filesystem exists.`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Pi
 *
 * JSON event stream mode: `pi --mode json "prompt"`. Emits JSONL, one event
 * per line, with a session header first. Streaming message updates are
 * delta-only, so assembly is linear.
 * ------------------------------------------------------------------ */

export const pi: HarnessAdapter = {
  id: "pi",
  label: "Pi",
  // Pi is the harness that can genuinely run without a filesystem, so it is
  // the only one allowed at Tier 0.
  allowedTiers: [0, 1, 2, 3],
  themeArg: (themeId) => ["--theme", `/workspace/.milo/themes/pi/${themeId}.json`],
  build(prompt, opts) {
    assertTier(pi, opts.tier);
    const args = ["--mode", "json", prompt];
    if (opts.model) args.push("--model", opts.model);
    if (opts.sessionId) args.push("--resume", opts.sessionId);
    return {
      command: "pi",
      args,
      cwd: opts.cwd ?? "/workspace",
      env: {},
      mutates: opts.tier >= 2,
      needsFilesystem: opts.tier >= 3,
    };
  },
  parse(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return null;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return null;
    }
    const type = String(ev.type ?? "");
    switch (type) {
      case "session":
        return { type: "session", id: String(ev.id ?? "") };
      case "message_update": {
        const inner = ev.assistantMessageEvent as { type?: string; delta?: string } | undefined;
        if (inner?.type === "text_delta" && inner.delta) return { type: "text", delta: inner.delta };
        if (inner?.type === "thinking_delta" && inner.delta) return { type: "thinking", delta: inner.delta };
        return null;
      }
      case "tool_execution_start":
        return { type: "tool-start", tool: String(ev.toolName ?? ""), args: ev.args };
      case "tool_execution_end":
        return { type: "tool-end", tool: String(ev.toolName ?? ""), ok: !ev.isError };
      case "message_end": {
        const usage = ev.usage as { inputTokens?: number; outputTokens?: number } | undefined;
        return usage
          ? { type: "message-end", usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 } }
          : { type: "message-end" };
      }
      case "error":
        return { type: "error", message: String(ev.message ?? "unknown pi error") };
      default:
        return null;
    }
  },
};

/* ------------------------------------------------------------------ *
 * OpenCode
 *
 * Two agents that matter here:
 *   plan / explore / scout  — read-only, Tier 0-1. They never edit, so they
 *                             never need a filesystem, so they never need a
 *                             container. This is the whole point.
 *   build                   — Tier 3 only. It is the only agent permitted to
 *                             touch the filesystem.
 * ------------------------------------------------------------------ */

export const opencode: HarnessAdapter = {
  id: "opencode",
  label: "OpenCode",
  // Read-only agents may run without a container. Build may not.
  allowedTiers: [0, 1, 3],
  themeArg: (themeId) => ["--theme", `milo-${themeId}`],
  build(prompt, opts) {
    assertTier(opencode, opts.tier);
    const readOnly = opts.tier <= 1;
    const agent = readOnly ? "plan" : "build";
    const args = ["run", "--agent", agent, "--print-logs", prompt];
    if (opts.model) args.push("--model", opts.model);
    return {
      command: "opencode",
      args,
      cwd: opts.cwd ?? "/workspace",
      env: {
        // Permissions are enforced twice: once here and once in the config
        // file shipped at themes/opencode/opencode.json. Belt and braces,
        // because this is the boundary that decides whether a container exists.
        OPENCODE_PERMISSION: readOnly ? JSON.stringify({ edit: "deny", bash: "deny" }) : JSON.stringify({ edit: "ask", bash: "ask" }),
      },
      mutates: !readOnly,
      needsFilesystem: !readOnly,
    };
  },
  parse(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      // OpenCode writes human-readable progress to stderr and JSON to stdout
      // when asked. Anything unstructured is ignored rather than guessed at.
      return null;
    }
    try {
      const ev = JSON.parse(trimmed) as Record<string, unknown>;
      const type = String(ev.type ?? "");
      if (type === "text") return { type: "text", delta: String(ev.text ?? "") };
      if (type === "reasoning") return { type: "thinking", delta: String(ev.text ?? "") };
      if (type === "tool") return { type: "tool-start", tool: String(ev.tool ?? ""), args: ev.input };
      if (type === "tool_result") return { type: "tool-end", tool: String(ev.tool ?? ""), ok: ev.error == null };
      if (type === "error") return { type: "error", message: String(ev.message ?? "unknown opencode error") };
      return null;
    } catch {
      return null;
    }
  },
};

export const HARNESSES: Record<HarnessId, HarnessAdapter> = {
  pi,
  opencode,
};

export function getHarness(id: HarnessId): HarnessAdapter {
  const h = HARNESSES[id];
  if (!h) throw new Error(`unknown harness: ${id}`);
  return h;
}

/**
 * The tier gate, in one function. Every tier decision in Milo routes through
 * here so there is exactly one place to audit.
 */
export function gateForTier(tier: Tier): {
  containerAllowed: boolean;
  filesystemAllowed: boolean;
  networkAllowed: boolean;
  reason: string;
} {
  switch (tier) {
    case 0:
      return {
        containerAllowed: false,
        filesystemAllowed: false,
        networkAllowed: true,
        reason: "Think. AI Gateway from the DO. No container, no filesystem.",
      };
    case 1:
      return {
        containerAllowed: false,
        filesystemAllowed: false,
        networkAllowed: true,
        reason: "Read. DO SQLite + R2 + Dynamic Worker isolates. No container.",
      };
    case 2:
      return {
        containerAllowed: false,
        filesystemAllowed: false,
        networkAllowed: true,
        reason:
          "Edit. Patch assembled in the DO, applied with git apply. Pure-JS tests run in an isolate. No container.",
      };
    case 3:
      return {
        containerAllowed: true,
        filesystemAllowed: true,
        networkAllowed: true,
        reason: "Exec. The only tier that may hold the container lease.",
      };
  }
}
