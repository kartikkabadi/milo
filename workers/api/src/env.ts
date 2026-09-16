import type { Sandbox } from "@cloudflare/sandbox";

/** Which harness is driving a session. Two separate tools. Do not conflate. */
export type HarnessId = "pi" | "opencode";

/**
 * The execution ladder. Lower tiers cannot boot a container — that is enforced
 * in code by the tier modules, not by convention.
 *
 *   0  think    Worker / DO only, via AI Gateway
 *   1  read     DO SQLite + R2 + Dynamic Worker isolates
 *   2  edit     same as 1, plus git apply, plus isolate-run pure-JS tests
 *   3  exec     the only tier allowed to touch a container
 */
export type Tier = 0 | 1 | 2 | 3;

export type SessionStatus =
  | "idle"
  | "thinking"
  | "reading"
  | "editing"
  | "testing"
  | "awaiting-approval"
  | "sleeping"
  | "snapshotting"
  | "waking"
  | "error";

/** Approval decisions. Mirrors OpenCode's allow / ask / deny. */
export type PermissionDecision = "allow" | "ask" | "deny";

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  tier: Tier;
  tool: string;
  /** Human-readable summary of exactly what will happen. */
  summary: string;
  /** The raw command or patch, for the diff viewer. */
  payload: string;
  /** True when this is a destructive-class action. */
  dangerous: boolean;
  createdAt: number;
  resolvedAt?: number;
  decision?: PermissionDecision;
  /** Who resolved it. Empty when auto-resolved by policy. */
  resolvedBy?: string;
}

export interface ModelChoice {
  /** Provider-qualified id, for example `anthropic/claude-sonnet-4-6`. */
  id: string;
  label: string;
  /** Rough relative cost, so the picker can sort cheapest-first. */
  tier: "cheap" | "standard" | "frontier";
}

export interface GitTimelineEntry {
  sha: string;
  subject: string;
  ts: number;
  kind: "agent" | "wip" | "human";
  /** Files touched, for the restore preview. */
  files: number;
  insertions: number;
  deletions: number;
}

/**
 * Where a session's bytes live. Git is the source of truth, not the VM.
 * `sha` is the authority; the R2 keys are a cache of it.
 */
export interface SnapshotPointer {
  sha: string;
  branch: string;
  ts: number;
  /** R2 key for the git bundle, when one was written. */
  bundleKey?: string;
  /** R2 key for the plain patch, when one was written. */
  patchKey?: string;
  /** R2 key for the untracked-files tarball, when one was written. */
  untrackedKey?: string;
  bytes: number;
  /** Seconds until R2 lifecycle expiry. 7 days by default. */
  ttl: number;
  /** How the snapshot was produced, so restore knows what it is holding. */
  strategy: "bundle" | "patch" | "both";
}

/** One row of the cost ledger. Written on every billed action. */
export interface LedgerEntry {
  ts: number;
  sessionId: string;
  tier: Tier;
  kind: "think" | "read" | "edit" | "test" | "snapshot" | "wake";
  /** Container seconds this action held the box awake, including any tail. */
  containerSeconds: number;
  /** Container vCPU-seconds actually burned. */
  vcpuSeconds: number;
  /** DO wall-clock seconds. */
  doSeconds: number;
  /** Billable DO requests. WS messages already divided by 20. */
  doRequests: number;
  /** R2 bytes written. */
  r2Bytes: number;
  /** vCPU busy fraction during the container window, for the idiot index. */
  cpuBusy: number;
}

/** Live state. Small on purpose — this syncs over the socket on every change. */
export interface MiloState {
  sessionId: string;
  harness: HarnessId | null;
  status: SessionStatus;
  tier: Tier | null;
  model: string | null;
  /** Repo the session is bound to. */
  repo: string | null;
  branch: string | null;
  /** Current HEAD, if the session has ever committed. */
  head: string | null;
  /** True while this session holds the container lease. */
  holdsLease: boolean;
  /** Position in the Tier-3 queue when it does not hold the lease. */
  queuePosition: number;
  /** Rolling totals for the GUI strip. Cheap to keep in state. */
  spend: {
    month: number;
    containerHours: number;
    tier3Duty: number;
    /** Live idiot index for container awake vs useful exec. */
    awakeIndex: number;
  };
  lastError: string | null;
  /** Wall-clock ms of the last activity. Drives the idle snapshot. */
  lastActivityTs: number;
}

export const initialState: MiloState = {
  sessionId: "",
  harness: null,
  status: "idle",
  tier: null,
  model: null,
  repo: null,
  branch: null,
  head: null,
  holdsLease: false,
  queuePosition: 0,
  spend: { month: 0, containerHours: 0, tier3Duty: 0, awakeIndex: 1 },
  lastError: null,
  lastActivityTs: 0,
};

/**
 * The Durable Object namespaces, typed with the real classes.
 *
 * Type-only imports, so there is no runtime cycle: `milo-session.ts` imports
 * `Env` from here, and this file imports the class back as a type. TypeScript
 * resolves that, and the RPC methods come back fully typed instead of arriving
 * as `unknown`.
 *
 * The alternative — hand-writing a structural interface — does not work with
 * Cloudflare's RPC types, which require the `DurableObjectBranded` marker that
 * only a real class extending `DurableObject` carries.
 */
import type { MiloSession } from "./agent/milo-session.ts";
import type { ContainerGate } from "./gate/container-gate.ts";
import type { AuthVault } from "./auth/vault.ts";

export interface Env {
  MILO_SESSION: DurableObjectNamespace<MiloSession>;
  CONTAINER_GATE: DurableObjectNamespace<ContainerGate>;
  MILO_AUTH: DurableObjectNamespace<AuthVault>;
  Sandbox: DurableObjectNamespace<Sandbox>;
  SNAPSHOTS: R2Bucket;
  AI: Ai;
  MILO_ENV: string;
  MILO_TIER3_DUTY_TARGET: string;
  MILO_MAX_TIER3_MS_PER_WAKE: string;
  /** Set by the outbound handler, never exposed to the sandbox. */
  GITHUB_TOKEN?: string;
  AI_GATEWAY_TOKEN?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}
