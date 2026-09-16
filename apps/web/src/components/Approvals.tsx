/**
 * Approvals.
 *
 * The rule the brief sets: OpenCode allow/ask/deny, Pi permission-gate. Both
 * reduce to the same two buttons here, with one difference that matters — a
 * destructive request says so, in the danger colour, before you click.
 *
 * "Allow" is never the visually dominant action on a destructive request. That
 * is the whole design decision in this component.
 */

import type { ApprovalRequest } from "../lib/types";

const TIER_LABEL: Record<number, string> = {
  0: "Think",
  1: "Read",
  2: "Edit",
  3: "Exec",
};

export function Approvals({
  approvals,
  onResolve,
}: {
  approvals: ApprovalRequest[];
  onResolve: (id: string, decision: "allow" | "deny") => void;
}) {
  if (approvals.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        {/* Olive branch, micro only. Empty states are the one place it goes. */}
        <svg width="34" height="34" viewBox="0 0 34 34" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M17 30 C17 20 17 12 17 5" />
          <path d="M17 22 C13 21 11 18.5 10.5 15.5 C14 16 16 18.5 17 22Z" />
          <path d="M17 15 C21 14 23 11.5 23.5 8.5 C20 9 18 11.5 17 15Z" />
          <path d="M17 26 C20.5 25.2 22.6 23 23 20 C19.6 20.8 17.6 23 17 26Z" />
        </svg>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Nothing waiting.
        </p>
        <p className="max-w-[240px] text-[11px]" style={{ color: "var(--muted)" }}>
          Milo asks once, for the thing that is destructive. Not for <code>git status</code>.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3 p-4">
      {approvals.map((a) => (
        <li
          key={a.id}
          className="overflow-hidden rounded-lg border"
          style={{
            borderColor: a.dangerous ? "var(--danger)" : "var(--border)",
            background: a.dangerous ? "var(--diff-removed-bg)" : "var(--surface)",
          }}
        >
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2" style={{ borderColor: a.dangerous ? "var(--danger)" : "var(--border)" }}>
            <div className="flex items-center gap-2 text-xs">
              <span className="mono" style={{ color: a.dangerous ? "var(--danger)" : "var(--muted)" }}>
                {a.tool}
              </span>
              <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>
                Tier {a.tier} · {TIER_LABEL[a.tier]}
              </span>
            </div>
            {a.dangerous && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide" style={{ background: "var(--danger)", color: "var(--background)" }}>
                destructive
              </span>
            )}
          </div>

          <div className="px-3 py-2">
            <p className="text-xs">{a.summary}</p>
            <pre
              className="mono mt-2 max-h-40 overflow-auto rounded p-2 text-[11px]"
              style={{ background: "var(--background)", color: "var(--muted)" }}
            >
              {a.payload}
            </pre>
          </div>

          <div className="flex items-center gap-2 px-3 py-2">
            {a.dangerous ? (
              <>
                <button
                  type="button"
                  onClick={() => onResolve(a.id, "deny")}
                  className="rounded px-3 py-1.5 text-xs font-medium"
                  style={{ background: "var(--foreground)", color: "var(--background)" }}
                >
                  Deny
                </button>
                <button
                  type="button"
                  onClick={() => onResolve(a.id, "allow")}
                  className="rounded border px-3 py-1.5 text-xs transition-colors hover:bg-[var(--surface-2)]"
                  style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                >
                  Allow anyway
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onResolve(a.id, "allow")}
                  className="rounded px-3 py-1.5 text-xs font-medium"
                  style={{ background: "var(--accent)", color: "var(--background)" }}
                >
                  Allow
                </button>
                <button
                  type="button"
                  onClick={() => onResolve(a.id, "deny")}
                  className="rounded border px-3 py-1.5 text-xs transition-colors hover:bg-[var(--surface-2)]"
                  style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                >
                  Deny
                </button>
              </>
            )}
            <span className="ml-auto text-[10px]" style={{ color: "var(--dim)" }}>
              {new Date(a.createdAt).toLocaleTimeString()}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
