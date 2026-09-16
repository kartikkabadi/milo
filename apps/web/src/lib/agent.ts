/**
 * Agent binding.
 *
 * Milo uses `useAgent`, not `useAgentChat`.
 *
 * The reason is not preference. `useAgentChat` models a message list, and
 * Milo's transcript is not a message list — it is a typed event stream where a
 * turn interleaves thinking, tier transitions, approvals, diffs, and a ledger
 * row. Every one of those carries a tier and a cost, and the GUI has to render
 * them inline in order. Forcing that through a chat-message schema would mean
 * smuggling structured data through message metadata and losing the ordering
 * guarantee that makes the transcript trustworthy.
 *
 * `useAgent` gives us state sync and RPC. The transcript is built from state
 * updates plus streamed tool events, which is what the server already emits.
 */

import { useAgent } from "agents/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminToken, onAdminTokenChange } from "./admin";
import type { ApprovalRequest, GitTimelineEntry, HarnessId, MiloState, Tier } from "./types";

export interface CostSummary {
  month: string;
  containerHours: number;
  containerVcpuSeconds: number;
  doSeconds: number;
  doRequests: number;
  r2Bytes: number;
  actions: number;
  byTier: Record<string, { actions: number; containerHours: number }>;
  usd: {
    containerMemory: number;
    containerDisk: number;
    containerCpu: number;
    containers: number;
    base: number;
    total: number;
  };
  awakeIndex: number;
  execSeconds: number;
}

export interface IdiotIndex {
  id: string;
  label: string;
  actual: number;
  theoretical: number;
  unit: string;
  remedy: string;
  index: number;
  flagged: boolean;
}

export type TranscriptEvent =
  | { kind: "prompt"; id: string; ts: number; tier: Tier; text: string }
  | { kind: "text"; id: string; ts: number; tier: Tier; text: string }
  | { kind: "thinking"; id: string; ts: number; tier: Tier; text: string }
  | { kind: "tool"; id: string; ts: number; tier: Tier; tool: string; ok: boolean | null; args?: unknown }
  | { kind: "tier"; id: string; ts: number; tier: Tier; text: string }
  | { kind: "approval"; id: string; ts: number; tier: Tier; approval: ApprovalRequest }
  | { kind: "cost"; id: string; ts: number; tier: Tier; text: string };

/**
 * The RPC surface, declared on the client.
 *
 * The server class lives in another workspace, so importing it here would drag
 * the Worker's dependencies into the browser bundle. Declaring the surface
 * locally and casting once at the boundary keeps the bundle clean and puts every
 * untyped hop in a single place instead of scattering `as` through the hooks.
 */
interface SessionRpc {
  run(tier: Tier, prompt: string): Promise<{ output: string }>;
  launch(opts: { harness: HarnessId; repo: string; model?: string }): Promise<{ log: string[] }>;
  sleep(reason?: string): Promise<{ sha: string | null; log: string[] }>;
  wake(opts: { repoUrl?: string }): Promise<{ sha: string | null; log: string[] }>;
  fork(sha: string): Promise<{ branch: string }>;
  setModel(model: string): Promise<{ ok: boolean }>;
  timeline(): Promise<GitTimelineEntry[]>;
  cost(): Promise<{ summary: CostSummary; indices: IdiotIndex[]; worst: IdiotIndex[] }>;
  gateStatus(): Promise<{ heldBy: string | null; expiresAt: number; queue: { sessionId: string; position: number }[] }>;
  pendingApprovals(): Promise<ApprovalRequest[]>;
  resolveApproval(id: string, decision: "allow" | "deny" | "ask", resolvedBy?: string): Promise<{ ok: boolean }>;
}

export interface SessionApi {
  state: MiloState | null;
  status: MiloState["status"] | "connecting";
  connected: boolean;
  transcript: TranscriptEvent[];
  approvals: ApprovalRequest[];
  timeline: GitTimelineEntry[];
  cost: CostSummary | null;
  indices: IdiotIndex[];
  worst: IdiotIndex[];
  gate: { heldBy: string | null; expiresAt: number; queue: { sessionId: string; position: number }[] } | null;
  send: (tier: Tier, prompt: string) => Promise<void>;
  resolve: (id: string, decision: "allow" | "deny") => Promise<void>;
  sleep: () => Promise<void>;
  wake: () => Promise<void>;
  setModel: (model: string) => Promise<void>;
  fork: (sha: string) => Promise<void>;
  launch: (harness: HarnessId, repo: string, model?: string) => Promise<void>;
  refreshTimeline: () => Promise<void>;
  refreshCost: () => Promise<void>;
  gateStatus: () => Promise<void>;
  error: string | null;
}

let eventSeq = 0;
const nextId = () => `e${++eventSeq}`;

export function useMiloSession(sessionId: string, agentHost = ""): SessionApi {
  // `useAgent` does not return `.state`. State arrives through `onStateUpdate`,
  // so it is tracked here. That is also why this hook owns the transcript: the
  // state stream and the tool-event stream have to be merged in one place to
  // keep ordering, and ordering is what makes the transcript trustworthy.
  const [state, setState] = useState<MiloState | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEvent[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [timeline, setTimeline] = useState<GitTimelineEntry[]>([]);
  const [cost, setCost] = useState<CostSummary | null>(null);
  const [indices, setIndices] = useState<IdiotIndex[]>([]);
  const [worst, setWorst] = useState<IdiotIndex[]>([]);
  const [gate, setGate] = useState<SessionApi["gate"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // A ref mirror of state, so the socket listener reads the current tier
  // without re-subscribing on every state change.
  const stateRef = useRef<MiloState | null>(null);
  stateRef.current = state;

  // The admin token can arrive after mount (typed into Connect). Track it as
  // state so queryDeps below re-resolves the socket query — otherwise the
  // agent would stay offline on the empty cached query until a reload.
  const [token, setToken] = useState(adminToken);
  useEffect(() => onAdminTokenChange(() => setToken(adminToken())), []);

  // Streaming buffers are refs, not state: a delta per token would re-render
  // the whole transcript hundreds of times per turn.
  const textBuf = useRef("");
  const thinkBuf = useRef("");
  const flushTimer = useRef<number | null>(null);

  const agent = useAgent<MiloState>({
    agent: "MiloSession",
    name: sessionId,
    host: agentHost || undefined,
    // A WebSocket handshake cannot set headers, so the admin token goes as a
    // query param; the Worker checks it on the /agents/ upgrade route.
    query: async (): Promise<Record<string, string | null>> => {
      const token = adminToken();
      return token ? { token } : {};
    },
    queryDeps: [token],
    onOpen: () => {
      setConnected(true);
      setError(null);
    },
    onClose: () => setConnected(false),
    onError: (e: Event) => {
      setConnected(false);
      setError(e instanceof ErrorEvent ? e.message : "socket error");
    },
    onStateUpdate: (next: MiloState) => setState(next),
  });

  /** The one place an untyped RPC hop happens. */
  const rpc = agent.stub as unknown as SessionRpc;

  const push = useCallback((event: TranscriptEvent) => {
    setTranscript((prev) => [...prev, event].slice(-400));
  }, []);

  /** Coalesce streamed deltas into one transcript entry per 60ms. */
  const scheduleFlush = useCallback(
    (kind: "text" | "thinking", tier: Tier) => {
      if (flushTimer.current !== null) return;
      flushTimer.current = window.setTimeout(() => {
        flushTimer.current = null;
        const buf = kind === "text" ? textBuf.current : thinkBuf.current;
        if (!buf) return;
        if (kind === "text") textBuf.current = "";
        else thinkBuf.current = "";
        push({ kind, id: nextId(), ts: Date.now(), tier, text: buf });
      }, 60);
    },
    [push],
  );

  // Streamed harness events arrive as raw messages. The server normalises them
  // into the HarnessEvent shape before sending, so the client only has to
  // switch on `type`.
  useEffect(() => {
    const handler = (raw: unknown) => {
      const ev = raw as { type?: string; delta?: string; tool?: string; ok?: boolean; args?: unknown; message?: string };
      const tier = (stateRef.current?.tier ?? 0) as Tier;
      switch (ev.type) {
        case "text":
          textBuf.current += ev.delta ?? "";
          scheduleFlush("text", tier);
          break;
        case "thinking":
          thinkBuf.current += ev.delta ?? "";
          scheduleFlush("thinking", tier);
          break;
        case "tool-start":
          push({ kind: "tool", id: nextId(), ts: Date.now(), tier, tool: ev.tool ?? "tool", ok: null, args: ev.args });
          break;
        case "tool-end":
          push({ kind: "tool", id: nextId(), ts: Date.now(), tier, tool: ev.tool ?? "tool", ok: ev.ok ?? false });
          break;
        case "error":
          setError(ev.message ?? "agent error");
          break;
        default:
          break;
      }
    };
    // useAgent exposes the socket through the returned agent object.
    const anyAgent = agent as unknown as { addEventListener?: (t: string, h: (e: MessageEvent) => void) => void; removeEventListener?: (t: string, h: (e: MessageEvent) => void) => void };
    const listener = (e: MessageEvent) => {
      try {
        handler(JSON.parse(String(e.data)));
      } catch {
        // Non-JSON frames are not ours.
      }
    };
    anyAgent.addEventListener?.("message", listener);
    return () => anyAgent.removeEventListener?.("message", listener);
  }, [agent, push, scheduleFlush]);

  // Surface tier changes as transcript events. A tier change is the single most
  // important thing in the transcript, because it is what the bill is made of.
  const lastTier = useRef<Tier | null>(null);
  useEffect(() => {
    const t = state?.tier ?? null;
    if (t === null || t === lastTier.current) return;
    lastTier.current = t;
    push({
      kind: "tier",
      id: nextId(),
      ts: Date.now(),
      tier: t,
      text:
        t === 0
          ? "Tier 0 — think. No container."
          : t === 1
            ? "Tier 1 — read. No container."
            : t === 2
              ? "Tier 2 — edit. No container."
              : "Tier 3 — exec. Container leased.",
    });
  }, [state?.tier, push]);

  const send = useCallback(
    async (tier: Tier, prompt: string) => {
      push({ kind: "prompt", id: nextId(), ts: Date.now(), tier, text: prompt });
      try {
        const result = await rpc.run(tier, prompt);
        if (result?.output) push({ kind: "text", id: nextId(), ts: Date.now(), tier, text: result.output });
      } catch (err) {
        setError(String(err instanceof Error ? err.message : err));
      }
    },
    [rpc, push],
  );

  const resolve = useCallback(
    async (id: string, decision: "allow" | "deny") => {
      await rpc.resolveApproval(id, decision, "human");
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    },
    [rpc],
  );

  const sleep = useCallback(async () => {
    const r = await rpc.sleep("gui");
    push({
      kind: "cost",
      id: nextId(),
      ts: Date.now(),
      tier: 3,
      text: r.sha ? `slept. snapshot at ${r.sha.slice(0, 8)}` : "slept. nothing to snapshot",
    });
  }, [rpc, push]);

  const wake = useCallback(async () => {
    const r = await rpc.wake({});
    push({ kind: "cost", id: nextId(), ts: Date.now(), tier: 3, text: `woke. ${r.sha ? `HEAD ${r.sha.slice(0, 8)}` : "clean start"}` });
  }, [rpc, push]);

  const setModel = useCallback(async (model: string) => void (await rpc.setModel(model)), [rpc]);

  const fork = useCallback(
    async (sha: string) => {
      const r = await rpc.fork(sha);
      push({ kind: "cost", id: nextId(), ts: Date.now(), tier: 3, text: `forked to ${r.branch}` });
      await refreshTimeline();
    },
    [rpc, push],
  );

  const launch = useCallback(
    async (harness: HarnessId, repo: string, model?: string) => {
      const r = await rpc.launch({ harness, repo, model });
      for (const line of r.log ?? []) push({ kind: "tier", id: nextId(), ts: Date.now(), tier: 0, text: line });
    },
    [rpc, push],
  );

  const refreshTimeline = useCallback(async () => {
    const rows = await rpc.timeline();
    setTimeline(rows);
  }, [rpc]);

  const refreshCost = useCallback(async () => {
    const r = await rpc.cost();
    setCost(r.summary);
    setIndices(r.indices);
    setWorst(r.worst);
  }, [rpc]);

  const gateStatus = useCallback(async () => {
    const g = await rpc.gateStatus();
    setGate(g);
  }, [rpc]);

  const loadApprovals = useCallback(async () => {
    const rows = await rpc.pendingApprovals();
    setApprovals(rows);
  }, [rpc]);

  useEffect(() => {
    if (!connected) return;
    void refreshCost();
    void refreshTimeline();
    void loadApprovals();
    void gateStatus();
    const t = window.setInterval(() => {
      void gateStatus();
      void loadApprovals();
    }, 5000);
    return () => window.clearInterval(t);
  }, [connected, refreshCost, refreshTimeline, loadApprovals, gateStatus]);

  const status = useMemo(() => (connected ? (state?.status ?? "idle") : "connecting"), [connected, state?.status]);

  return {
    state,
    status,
    connected,
    transcript,
    approvals,
    timeline,
    cost,
    indices,
    worst,
    gate,
    send,
    resolve,
    sleep,
    wake,
    setModel,
    fork,
    launch,
    refreshTimeline,
    refreshCost,
    gateStatus,
    error,
  };
}
