/**
 * Git timeline.
 *
 * Milo's persistence story is git, so the timeline is the recovery UI. Every
 * entry is restorable, and restoring forks rather than rewinding — a rewind of
 * a branch you might want back is the kind of thing people regret.
 *
 * The `wip(agent)` rows are the snapshots taken on sleep. They are shown, not
 * hidden, because "what did it save" is the question a watcher has to answer.
 */

import { useState } from "react";
import type { GitTimelineEntry } from "../lib/types";

const KIND_META: Record<GitTimelineEntry["kind"], { label: string; color: string }> = {
  agent: { label: "agent", color: "var(--accent)" },
  wip: { label: "snapshot", color: "var(--keyline)" },
  human: { label: "you", color: "var(--muted)" },
};

function relative(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function GitTimeline({
  entries,
  head,
  onFork,
  onRestore,
}: {
  entries: GitTimelineEntry[];
  head: string | null;
  onFork: (sha: string) => void;
  onRestore?: (sha: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <div className="p-4 text-xs" style={{ color: "var(--muted)" }}>
        no commits yet. Milo commits a <code>wip(agent)</code> snapshot when a session sleeps.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4 py-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
        <span className="mono">agent/&lt;session&gt;</span>
        {head && (
          <>
            <span className="mx-2" style={{ color: "var(--dim)" }}>
              ·
            </span>
            <span className="mono" style={{ color: "var(--accent)" }}>
              HEAD {head.slice(0, 8)}
            </span>
          </>
        )}
      </div>

      <ol className="min-h-0 flex-1 overflow-auto">
        {entries.map((e, i) => {
          const meta = KIND_META[e.kind];
          const isHead = e.sha === head;
          return (
            <li key={e.sha}>
              <button
                type="button"
                onClick={() => setSelected(selected === e.sha ? null : e.sha)}
                className="flex w-full items-start gap-3 border-b px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-2)]"
                style={{ borderColor: "var(--border)" }}
              >
                {/* Branch rail. The first row has no rail above it. */}
                <span className="relative mt-1 flex h-full w-3 shrink-0 justify-center" aria-hidden="true">
                  {i > 0 && <span className="absolute -top-3 h-3 w-px" style={{ background: "var(--border-accent)" }} />}
                  <span
                    className="h-2.5 w-2.5 rounded-full border-2"
                    style={{ borderColor: meta.color, background: isHead ? meta.color : "var(--background)" }}
                  />
                  {i < entries.length - 1 && <span className="absolute top-3 h-full w-px" style={{ background: "var(--border-accent)" }} />}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="mono text-xs" style={{ color: "var(--accent)" }}>
                      {e.sha.slice(0, 7)}
                    </span>
                    <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: "var(--surface-2)", color: meta.color }}>
                      {meta.label}
                    </span>
                    {isHead && (
                      <span className="text-[10px]" style={{ color: "var(--success)" }}>
                        current
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs" style={{ color: "var(--foreground)" }}>
                    {e.subject}
                  </span>
                  <span className="mt-0.5 block text-[10px]" style={{ color: "var(--dim)" }}>
                    {relative(e.ts)}
                    {e.files > 0 && (
                      <>
                        {" · "}
                        {e.files} files <span style={{ color: "var(--diff-added)" }}>+{e.insertions}</span>{" "}
                        <span style={{ color: "var(--diff-removed)" }}>−{e.deletions}</span>
                      </>
                    )}
                  </span>
                </span>
              </button>

              {selected === e.sha && (
                <div className="flex items-center gap-2 px-4 pb-3 pl-11" style={{ background: "var(--surface-2)" }}>
                  <button
                    type="button"
                    onClick={() => onFork(e.sha)}
                    className="rounded px-2.5 py-1 text-xs font-medium"
                    style={{ background: "var(--accent)", color: "var(--background)" }}
                  >
                    Fork from here
                  </button>
                  {onRestore && (
                    <button
                      type="button"
                      onClick={() => onRestore(e.sha)}
                      className="rounded border px-2.5 py-1 text-xs"
                      style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                    >
                      Restore
                    </button>
                  )}
                  <span className="text-[10px]" style={{ color: "var(--dim)" }}>
                    Fork cuts a new branch. Nothing is rewound.
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
