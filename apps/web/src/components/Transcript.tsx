/**
 * Transcript.
 *
 * The reason this is not `useAgentChat`: a turn interleaves thinking, tier
 * transitions, approvals, tool calls, and cost events, and every one of them
 * carries a tier. The transcript is where the cost model becomes visible to a
 * human — you can watch a turn stay in Tier 1 and cost nothing, then watch it
 * cross into Tier 3 and start the meter.
 *
 * Tier badges are not decoration. They are the product's central claim, rendered.
 */

import { useEffect, useRef } from "react";
import type { TranscriptEvent } from "../lib/agent";
import { TIERS } from "../lib/types";

const TIER_COLOR: Record<number, string> = {
  0: "var(--muted)",
  1: "var(--accent-2)",
  2: "var(--info)",
  3: "var(--accent)",
};

function TierBadge({ tier }: { tier: number }) {
  const meta = TIERS[tier];
  return (
    <span
      className="mono shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
      style={{ background: "var(--surface-2)", color: TIER_COLOR[tier] }}
      title={meta?.where}
    >
      T{tier} {meta?.name}
    </span>
  );
}

export function Transcript({ events, status }: { events: TranscriptEvent[]; status: string }) {
  const endRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Auto-scroll only while the reader is already at the bottom. Yanking a
  // transcript away from someone who scrolled up to read is worse than not
  // following.
  useEffect(() => {
    if (pinned.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [events.length]);

  return (
    <div
      className="min-h-0 flex-1 overflow-auto px-4 py-3"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}
    >
      {events.length === 0 && (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Session ready.
          </p>
          <p className="max-w-[280px] text-[11px]" style={{ color: "var(--dim)" }}>
            Tiers 0–2 run without a container. Only Tier 3 leases one, and only Tier 3 costs anything.
          </p>
        </div>
      )}

      <ul className="flex flex-col gap-2.5">
        {events.map((e) => {
          if (e.kind === "prompt") {
            return (
              <li key={e.id} className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2">
                  <TierBadge tier={e.tier} />
                  <span className="text-[10px]" style={{ color: "var(--dim)" }}>
                    you
                  </span>
                </div>
                <p
                  className="max-w-[85%] rounded-lg px-3 py-2 text-xs"
                  style={{ background: "var(--surface-2)", color: "var(--foreground)" }}
                >
                  {e.text}
                </p>
              </li>
            );
          }

          if (e.kind === "thinking") {
            return (
              <li key={e.id} className="flex gap-2">
                <TierBadge tier={e.tier} />
                <p className="whitespace-pre-wrap text-[11px] italic" style={{ color: "var(--dim)" }}>
                  {e.text}
                </p>
              </li>
            );
          }

          if (e.kind === "tier") {
            return (
              <li key={e.id} className="flex items-center gap-2 py-0.5">
                <span className="h-px flex-1" style={{ background: "var(--border)" }} />
                <span className="text-[10px]" style={{ color: TIER_COLOR[e.tier] }}>
                  {e.text}
                </span>
                <span className="h-px flex-1" style={{ background: "var(--border)" }} />
              </li>
            );
          }

          if (e.kind === "tool") {
            return (
              <li key={e.id} className="flex items-center gap-2">
                <TierBadge tier={e.tier} />
                <span className="mono text-[11px]" style={{ color: "var(--muted)" }}>
                  {e.tool}
                </span>
                {e.ok === null ? (
                  <span className="text-[10px]" style={{ color: "var(--dim)" }}>
                    running…
                  </span>
                ) : e.ok ? (
                  <span className="laurel" style={{ color: "var(--success)" }} aria-label="succeeded">
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                      <path d="M2.5 6.4 L4.8 8.6 L9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                ) : (
                  <span className="text-[10px]" style={{ color: "var(--danger)" }}>
                    failed
                  </span>
                )}
              </li>
            );
          }

          if (e.kind === "cost") {
            return (
              <li key={e.id} className="flex items-start gap-2">
                <TierBadge tier={e.tier} />
                <span className="mono text-[11px]" style={{ color: "var(--keyline)" }}>
                  {e.text}
                </span>
              </li>
            );
          }

          // Everything else is assistant text. Narrowed explicitly so adding a
          // new event kind is a compile error here rather than a blank bubble.
          if (e.kind === "text") {
            return (
              <li key={e.id} className="flex gap-2">
                <TierBadge tier={e.tier} />
                <p className="whitespace-pre-wrap text-xs" style={{ color: "var(--foreground)" }}>
                  {e.text}
                </p>
              </li>
            );
          }

          return null;
        })}
      </ul>

      {(status === "thinking" || status === "reading" || status === "editing" || status === "testing") && (
        <div className="mt-3 flex items-center gap-2 text-[11px]" style={{ color: "var(--dim)" }}>
          <span className="inline-flex gap-1">
            <span className="h-1 w-1 animate-pulse rounded-full" style={{ background: "var(--accent)" }} />
            <span className="h-1 w-1 animate-pulse rounded-full [animation-delay:150ms]" style={{ background: "var(--accent)" }} />
            <span className="h-1 w-1 animate-pulse rounded-full [animation-delay:300ms]" style={{ background: "var(--accent)" }} />
          </span>
          {status}…
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
