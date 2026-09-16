/** Shared types. Mirrors workers/api/src/env.ts. Kept narrow on purpose. */

export type HarnessId = "pi" | "opencode";
export type Tier = 0 | 1 | 2 | 3;
export type PermissionDecision = "allow" | "ask" | "deny";

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

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  tier: Tier;
  tool: string;
  summary: string;
  payload: string;
  dangerous: boolean;
  createdAt: number;
  resolvedAt?: number;
  decision?: PermissionDecision;
  resolvedBy?: string;
}

export interface GitTimelineEntry {
  sha: string;
  subject: string;
  ts: number;
  kind: "agent" | "wip" | "human";
  files: number;
  insertions: number;
  deletions: number;
}

export interface MiloState {
  sessionId: string;
  harness: HarnessId | null;
  status: SessionStatus;
  tier: Tier | null;
  model: string | null;
  repo: string | null;
  branch: string | null;
  head: string | null;
  holdsLease: boolean;
  queuePosition: number;
  spend: { month: number; containerHours: number; tier3Duty: number; awakeIndex: number };
  lastError: string | null;
  lastActivityTs: number;
}

/** The tier ladder, as data, so the GUI and the server cannot disagree. */
export const TIERS: { tier: Tier; name: string; label: string; where: string; container: boolean }[] = [
  { tier: 0, name: "think", label: "Think", where: "AI Gateway, from the Durable Object", container: false },
  { tier: 1, name: "read", label: "Read", where: "DO SQLite + R2 + Dynamic Worker isolates", container: false },
  { tier: 2, name: "edit", label: "Edit", where: "Patch in the DO, git apply, isolate tests", container: false },
  { tier: 3, name: "test", label: "Exec", where: "The container. The only tier that has one.", container: true },
];

export const HARNESSES: { id: HarnessId; label: string; tiers: string; note: string }[] = [
  {
    id: "pi",
    label: "Pi",
    tiers: "0 · 1 · 2 · 3",
    note: "Runs in every tier. The only harness that can genuinely work without a filesystem.",
  },
  {
    id: "opencode",
    label: "OpenCode",
    tiers: "0 · 1 · 3",
    note: "Plan, Explore, and Scout are read-only and stay in Tiers 0–1. Build is Tier 3 only.",
  },
];

/** One row of the Connect panel. Mirrors AuthVault's ProviderStatus. */
export interface ProviderInfo {
  id: string;
  label: string;
  apiKey: { hint: string } | null;
  oauth: { flow: "device" | "code"; harnesses: HarnessId[]; label: string } | null;
  connected: boolean;
  kind?: "api" | "oauth";
  /** Last four characters of the stored credential. Never the secret. */
  hint?: string;
  /** Which harnesses the stored credential feeds. */
  feeds?: HarnessId[];
}

export type OAuthDisplay = { flowId: string } & (
  | { kind: "device"; userCode: string; verificationUri: string; interval: number; expiresIn: number }
  | { kind: "code"; url: string; instructions: string }
);

export const MODELS = [
  { id: "anthropic/claude-sonnet-4-6", label: "Sonnet 4.6", tier: "standard" as const },
  { id: "anthropic/claude-haiku-4-5", label: "Haiku 4.5", tier: "cheap" as const },
  { id: "openai/gpt-5.4-mini", label: "GPT-5.4 mini", tier: "cheap" as const },
  { id: "openai/gpt-5.4", label: "GPT-5.4", tier: "frontier" as const },
  { id: "google/gemini-3-pro", label: "Gemini 3 Pro", tier: "frontier" as const },
];
