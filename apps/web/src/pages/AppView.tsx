/**
 * The app shell.
 *
 * Layout is deliberately three columns with a fixed rhythm, because the
 * argument of the product is that you can see what it is doing and what it is
 * costing at the same time. Hiding the cost in a settings page would undercut
 * the entire claim.
 *
 *   left    sessions, harness, model          — fluted rail
 *   centre  transcript, terminal, diff, timeline
 *   right   approvals, cost ledger, idiot index
 */

import { useMemo, useState } from "react";
import { Mark, Meander, SleepWakeRing, Wordmark } from "../components/Brand";
import { ThemeMenu } from "../components/ThemeMenu";
import { TerminalPanel } from "../components/TerminalPanel";
import { DiffViewer } from "../components/DiffViewer";
import { CostLedger } from "../components/CostLedger";
import { Approvals } from "../components/Approvals";
import { GitTimeline } from "../components/GitTimeline";
import { Transcript } from "../components/Transcript";
import { HARNESSES, MODELS, TIERS, type HarnessId, type Tier } from "../lib/types";
import { useMiloSession } from "../lib/agent";
import { resolveInitialTheme } from "../lib/themes";

type Tab = "chat" | "terminal" | "diff" | "timeline";

const SAMPLE_DIFF = `diff --git a/workers/api/src/agent/snapshot.ts b/workers/api/src/agent/snapshot.ts
index 3f2a1c8..9b4e0d1 100644
--- a/workers/api/src/agent/snapshot.ts
+++ b/workers/api/src/agent/snapshot.ts
@@ -112,9 +112,12 @@ export async function commitWip(
   for (const [cmd, args] of steps) {
     const r = await sandbox.exec(cmd, { args });
     log.push(\`\${cmd} \${args.join(" ")} -> exit \${r.exitCode}\`);
-    if (!r.success) {
-      throw new Error(\`\${cmd} failed\`);
+    if (!r.success && cmd === "git" && args[0] === "update-index") {
+      // Refresh can fail on a dirty index. Clear the lock and carry on.
+      await sandbox.exec("rm", { args: ["-f", ".git/index.lock"] });
+      log.push("cleared .git/index.lock");
     }
   }
`;

function TierLadder({ active }: { active: Tier | null }) {
  return (
    <div className="space-y-1">
      {TIERS.map((t) => {
        const on = active === t.tier;
        return (
          <div
            key={t.tier}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-[11px] transition-colors"
            style={{
              background: on ? "var(--surface-2)" : "transparent",
              color: on ? "var(--foreground)" : "var(--muted)",
            }}
            title={t.where}
          >
            <span
              className="mono h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: on ? (t.container ? "var(--accent)" : "var(--accent-2)") : "var(--border)" }}
            />
            <span className="mono">{t.tier}</span>
            <span className="flex-1 truncate">{t.label}</span>
            {t.container ? (
              <span className="text-[9px] uppercase" style={{ color: "var(--accent)" }}>
                container
              </span>
            ) : (
              <span className="text-[9px] uppercase" style={{ color: "var(--dim)" }}>
                free
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AppView({ sessionId }: { sessionId: string }) {
  const [themeId] = useState(() => resolveInitialTheme());
  const [tab, setTab] = useState<Tab>("chat");
  const [harness, setHarness] = useState<HarnessId>("pi");
  const [model, setModel] = useState(MODELS[0].id);
  const [draft, setDraft] = useState("");
  const [tier, setTier] = useState<Tier>(0);
  const [yolo, setYolo] = useState(false);

  const session = useMiloSession(sessionId);
  const state = session.state;

  const spend = useMemo(() => {
    const month = session.cost?.usd.total ?? 0;
    const hours = session.cost?.containerHours ?? 0;
    return { month, hours };
  }, [session.cost]);

  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await session.send(tier, text, { yoloApproved: yolo });
  };

  return (
    <div className="flex h-dvh flex-col" style={{ background: "var(--background)" }}>
      {/* Header. Mark on the left, status in the middle, theme on the right.
          The wordmark is never here — it and the mark are never locked up. */}
      <header className="flex shrink-0 items-center gap-4 border-b px-4 py-2.5" style={{ borderColor: "var(--border)" }}>
        <a href="/" className="flex items-center gap-2" style={{ color: "var(--accent)" }} aria-label="milo home">
          <Mark size={22} />
        </a>
        <span className="mono text-xs" style={{ color: "var(--muted)" }}>
          {sessionId}
        </span>

        <span className="flex items-center gap-2 text-[11px]" style={{ color: session.connected ? "var(--success)" : "var(--danger)" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
          {session.connected ? "live" : "offline"}
        </span>

        {state?.holdsLease && (
          <span className="rounded px-2 py-0.5 text-[10px] uppercase tracking-wide" style={{ background: "var(--accent)", color: "var(--background)" }}>
            holds container lease
          </span>
        )}
        {!state?.holdsLease && (session.gate?.queue?.length ?? 0) > 0 && (
          <span className="rounded px-2 py-0.5 text-[10px]" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>
            {session.gate?.queue.length} waiting for the container
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className="mono hidden text-xs tabular-nums sm:inline" style={{ color: "var(--muted)" }}>
            {spend.hours.toFixed(1)} h · ${spend.month.toFixed(2)}
          </span>
          <SleepWakeRing status={session.status} size={30} />
          <ThemeMenu />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left rail */}
        <aside className="fluted hidden w-60 shrink-0 flex-col gap-5 overflow-auto border-r p-4 pl-5 lg:flex" style={{ borderColor: "var(--border)" }}>
          <div>
            <h2 className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Tier ladder
            </h2>
            <p className="mt-1 text-[10px]" style={{ color: "var(--muted)" }}>
              Lower tiers cannot boot a container.
            </p>
            <div className="mt-2">
              <TierLadder active={state?.tier ?? null} />
            </div>
          </div>

          <div>
            <h2 className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Harness
            </h2>
            <div className="mt-2 space-y-1">
              {HARNESSES.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setHarness(h.id)}
                  className="w-full rounded px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--surface-2)]"
                  style={{ background: harness === h.id ? "var(--surface-2)" : "transparent" }}
                  title={h.note}
                >
                  <span className="flex items-center justify-between">
                    <span style={{ color: harness === h.id ? "var(--foreground)" : "var(--muted)" }}>{h.label}</span>
                    <span className="mono text-[9px]" style={{ color: "var(--muted)" }}>
                      {h.tiers}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Model
            </h2>
            <div className="mt-2 space-y-1">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setModel(m.id);
                    void session.setModel(m.id);
                  }}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--surface-2)]"
                  style={{ background: model === m.id ? "var(--surface-2)" : "transparent" }}
                >
                  <span style={{ color: model === m.id ? "var(--foreground)" : "var(--muted)" }}>{m.label}</span>
                  <span
                    className="text-[9px] uppercase"
                    style={{
                      color:
                        m.tier === "cheap" ? "var(--success)" : m.tier === "frontier" ? "var(--warn)" : "var(--dim)",
                    }}
                  >
                    {m.tier}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-auto">
            <Meander />
            <p className="mt-2 text-[10px]" style={{ color: "var(--dim)" }}>
              LLM tokens are excluded from every number in this GUI.
            </p>
          </div>
        </aside>

        {/* Centre */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-1 border-b px-3" style={{ borderColor: "var(--border)" }}>
            {(["chat", "terminal", "diff", "timeline"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className="relative px-3 py-2 text-xs capitalize transition-colors"
                style={{ color: tab === t ? "var(--foreground)" : "var(--muted)" }}
              >
                {t}
                {tab === t && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full" style={{ background: "var(--accent)" }} />}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void session.refreshTimeline()}
              className="ml-auto px-2 py-2 text-[10px]"
              style={{ color: "var(--dim)" }}
            >
              refresh
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            {tab === "chat" && <Transcript events={session.transcript} status={session.status} />}
            {tab === "terminal" && (
              <TerminalPanel themeId={themeId} sessionId={sessionId} connected={session.connected} />
            )}
            {tab === "diff" && (
              <div className="min-h-0 flex-1 p-3">
                <DiffViewer diff={SAMPLE_DIFF} title="wip(agent) — last snapshot" />
              </div>
            )}
            {tab === "timeline" && (
              <GitTimeline entries={session.timeline} head={state?.head ?? null} onFork={(sha) => void session.fork(sha)} />
            )}
          </div>

          {/* Composer. Tier is chosen explicitly, because tier is the bill. */}
          <div className="shrink-0 border-t p-3" style={{ borderColor: "var(--border)" }}>
            <div className="mb-2 flex items-center gap-1.5">
              {TIERS.map((t) => (
                <button
                  key={t.tier}
                  type="button"
                  onClick={() => setTier(t.tier)}
                  title={t.where}
                  aria-pressed={tier === t.tier}
                  className="mono rounded border px-2 py-1 text-[10px] uppercase tracking-wide transition-colors"
                  style={{
                    background: tier === t.tier ? (t.container ? "var(--accent)" : "var(--accent-2)") : "transparent",
                    color: tier === t.tier ? "var(--background)" : "var(--foreground)",
                    // The border is what makes an unselected button legible on a
                    // warm off-black background. Without it, surface-2 on
                    // background is a 1.3:1 contrast ratio and the control
                    // disappears.
                    borderColor: tier === t.tier ? "transparent" : "var(--border-accent)",
                  }}
                >
                  T{t.tier} {t.name}
                </button>
              ))}
              {tier === 3 && (
                <label className="ml-2 flex items-center gap-1.5 text-[10px]" style={{ color: yolo ? "var(--danger)" : "var(--muted)" }}>
                  <input type="checkbox" checked={yolo} onChange={(e) => setYolo(e.target.checked)} />
                  --yolo (needs an approval)
                </label>
              )}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
                }}
                rows={2}
                placeholder={tier === 3 ? "This will lease the container." : "This runs without a container."}
                className="min-h-[46px] flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-xs outline-none"
                style={{ borderColor: "var(--border)" }}
              />
              <button
                type="button"
                onClick={() => void submit()}
                className="rounded-md px-4 py-2 text-xs font-medium"
                style={{ background: "var(--accent)", color: "var(--background)" }}
              >
                Run
              </button>
            </div>
            <div className="mt-2 flex items-center gap-3 text-[10px]" style={{ color: "var(--dim)" }}>
              <span>⌘↵ to run</span>
              <button type="button" onClick={() => void session.sleep()} className="underline decoration-dotted">
                sleep now
              </button>
              <button type="button" onClick={() => void session.wake()} className="underline decoration-dotted">
                wake
              </button>
              <button type="button" onClick={() => void session.refreshCost()} className="underline decoration-dotted">
                refresh cost
              </button>
              {session.error && <span style={{ color: "var(--danger)" }}>{session.error}</span>}
            </div>
          </div>
        </main>

        {/* Right rail */}
        <aside className="hidden w-80 shrink-0 flex-col overflow-hidden border-l xl:flex" style={{ borderColor: "var(--border)" }}>
          <div className="flex shrink-0 items-center justify-between border-b px-4 py-2" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Approvals
            </h2>
            {session.approvals.length > 0 && (
              <span className="rounded-full px-1.5 text-[10px]" style={{ background: "var(--danger)", color: "var(--background)" }}>
                {session.approvals.length}
              </span>
            )}
          </div>
          <div className="max-h-72 shrink-0 overflow-auto">
            <Approvals approvals={session.approvals} onResolve={(id, d) => void session.resolve(id, d)} />
          </div>

          <div className="meander" />

          <div className="flex shrink-0 items-center justify-between border-b px-4 py-2" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Cost
            </h2>
            <span className="mono text-[10px]" style={{ color: "var(--muted)" }}>
              ${(session.cost?.usd.total ?? 0).toFixed(2)}/mo
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <CostLedger cost={session.cost} indices={session.indices} worst={session.worst} />
          </div>
        </aside>
      </div>

      {/* Footer wordmark. Alone, as the rules require. */}
      <footer className="flex shrink-0 items-center justify-between border-t px-4 py-2" style={{ borderColor: "var(--border)" }}>
        <span style={{ color: "var(--dim)" }}>
          <Wordmark height={14} />
        </span>
        <span className="text-[10px]" style={{ color: "var(--dim)" }}>
          the friend that minds your agents
        </span>
      </footer>
    </div>
  );
}
