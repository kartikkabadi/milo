/**
 * Diff viewer.
 *
 * Renders a unified diff with the theme's own diff tokens, so every one of the
 * seven themes carries its own added/removed/context colours. Nothing is
 * hard-coded, which is why Forge Red's diff looks like a warning and Hellas
 * Marble's looks like a page of corrections.
 */

import { useMemo, useState } from "react";

interface Row {
  kind: "add" | "del" | "ctx" | "hunk" | "meta";
  text: string;
  oldLine?: number;
  newLine?: number;
}

function parse(diff: string): Row[] {
  const rows: Row[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (m) {
        oldLine = Number(m[1]);
        newLine = Number(m[2]);
      }
      rows.push({ kind: "hunk", text: raw });
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff ") || raw.startsWith("index ")) {
      rows.push({ kind: "meta", text: raw });
      continue;
    }
    if (raw.startsWith("+")) {
      rows.push({ kind: "add", text: raw.slice(1), newLine: newLine++ });
      continue;
    }
    if (raw.startsWith("-")) {
      rows.push({ kind: "del", text: raw.slice(1), oldLine: oldLine++ });
      continue;
    }
    rows.push({ kind: "ctx", text: raw.startsWith(" ") ? raw.slice(1) : raw, oldLine: oldLine++, newLine: newLine++ });
  }
  return rows;
}

export function DiffViewer({ diff, title }: { diff: string; title?: string }) {
  const [wrap, setWrap] = useState(false);
  const rows = useMemo(() => parse(diff), [diff]);

  const counts = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const r of rows) {
      if (r.kind === "add") added++;
      if (r.kind === "del") removed++;
    }
    return { added, removed };
  }, [rows]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="flex items-center gap-3 text-xs">
          <span className="mono" style={{ color: "var(--muted)" }}>
            {title ?? "diff"}
          </span>
          <span style={{ color: "var(--diff-added)" }}>+{counts.added}</span>
          <span style={{ color: "var(--diff-removed)" }}>−{counts.removed}</span>
        </div>
        <button
          type="button"
          onClick={() => setWrap((v) => !v)}
          className="rounded px-2 py-1 text-xs transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: "var(--muted)" }}
        >
          {wrap ? "no wrap" : "wrap"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto" style={{ background: "var(--surface)" }}>
        <table className="w-full border-collapse text-xs">
          <tbody className="mono">
            {rows.map((row, i) => (
              <tr
                key={i}
                className={
                  row.kind === "add" ? "diff-add" : row.kind === "del" ? "diff-del" : row.kind === "hunk" ? "diff-pending" : ""
                }
              >
                <td
                  className="w-10 select-none px-2 text-right align-top"
                  style={{ color: "var(--diff-context)", background: "var(--surface-2)" }}
                >
                  {row.oldLine ?? ""}
                </td>
                <td
                  className="w-10 select-none px-2 text-right align-top"
                  style={{ color: "var(--diff-context)", background: "var(--surface-2)" }}
                >
                  {row.newLine ?? ""}
                </td>
                <td
                  className="w-4 select-none text-center align-top"
                  style={{ color: row.kind === "add" ? "var(--diff-added)" : row.kind === "del" ? "var(--diff-removed)" : "var(--diff-context)" }}
                >
                  {row.kind === "add" ? "+" : row.kind === "del" ? "−" : row.kind === "hunk" ? "" : " "}
                </td>
                <td className={`px-2 align-top ${row.kind === "ctx" ? "diff-ctx" : ""}`} style={{ whiteSpace: wrap ? "pre-wrap" : "pre" }}>
                  {row.text || " "}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The live mini-diff on the landing page. Typeable: the visitor edits the
 * left side and the right side re-renders through the same parser the real
 * viewer uses, so the demo cannot lie about how the real thing behaves.
 */
export function MiniDiff({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col overflow-hidden rounded-lg border" style={{ borderColor: "var(--border)" }}>
        <div className="border-b px-3 py-2 text-xs" style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--muted)" }}>
          <span className="mono">type here</span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="mono min-h-[240px] flex-1 resize-none bg-transparent p-3 text-xs outline-none"
          style={{ background: "var(--surface)", color: "var(--foreground)" }}
        />
      </div>
      <DiffViewer diff={text} title="rendered" />
    </div>
  );
}
