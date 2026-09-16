/**
 * Cost ledger and the idiot index.
 *
 * The design rule: a cost panel that only shows a total hides the thing you
 * need. So the panel leads with the **idiot index**, ranks the three worst, and
 * shows the arithmetic for each. The dollar figure is the last row, not the
 * first.
 *
 * Every number here comes from the same functions that `bun run cost` uses on
 * the server, so the panel cannot disagree with COST_MODEL.md.
 */

import { useState } from "react";
import type { CostSummary, IdiotIndex } from "../lib/agent";

const usd = (n: number, digits = 4) => `$${n.toFixed(digits)}`;
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

function Row({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs" style={{ color: strong ? "var(--foreground)" : "var(--muted)" }}>
        {label}
        {hint && (
          <span className="ml-2 text-[10px]" style={{ color: "var(--dim)" }}>
            {hint}
          </span>
        )}
      </span>
      <span className="mono text-xs tabular-nums" style={{ color: strong ? "var(--foreground)" : "var(--muted)" }}>
        {value}
      </span>
    </div>
  );
}

function IndexBar({ index }: { index: IdiotIndex }) {
  const capped = Math.min(index.index, 40);
  const width = (capped / 40) * 100;
  const color = index.flagged ? "var(--danger)" : index.index > 3 ? "var(--warn)" : "var(--success)";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${width}%`, background: color }} />
    </div>
  );
}

export function CostLedger({ cost, indices, worst }: { cost: CostSummary | null; indices: IdiotIndex[]; worst: IdiotIndex[] }) {
  const [showAll, setShowAll] = useState(false);
  if (!cost) {
    return (
      <div className="p-4 text-xs" style={{ color: "var(--muted)" }}>
        no ledger rows yet. cost appears after the first action.
      </div>
    );
  }

  const rows = showAll ? indices : worst;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Idiot index first. This is the point of the panel. */}
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Idiot index
          </h3>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[10px] underline decoration-dotted"
            style={{ color: "var(--muted)" }}
          >
            {showAll ? "show worst 3" : `show all ${indices.length}`}
          </button>
        </div>
        <p className="mt-1 text-[10px]" style={{ color: "var(--muted)" }}>
          actual ÷ theoretical minimum. Above 10× is flagged.
        </p>

        <ul className="mt-3 space-y-3">
          {rows.map((ix) => (
            <li key={ix.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs">{ix.label}</span>
                <span className="mono text-xs tabular-nums" style={{ color: ix.flagged ? "var(--danger)" : "var(--muted)" }}>
                  {ix.index.toFixed(2)}×
                </span>
              </div>
              <div className="mt-1.5">
                <IndexBar index={ix} />
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-3">
                <span className="mono text-[10px]" style={{ color: "var(--dim)" }}>
                  {ix.actual.toLocaleString()} / {ix.theoretical.toLocaleString()} {ix.unit}
                </span>
                {ix.flagged && (
                  <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: "var(--diff-removed-bg)", color: "var(--danger)" }}>
                    flagged
                  </span>
                )}
              </div>
              {ix.flagged && (
                <p className="mt-1.5 text-[11px]" style={{ color: "var(--muted)" }}>
                  {ix.remedy}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="meander" />

      {/* Tier split. Where the container-hours actually went. */}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          By tier
        </h3>
        <div className="mt-2 space-y-1">
          {[0, 1, 2, 3].map((t) => {
            const row = cost.byTier[String(t)];
            if (!row) return null;
            return (
              <Row
                key={t}
                label={`Tier ${t}`}
                hint={t === 3 ? "container" : "no container"}
                value={`${row.actions} · ${row.containerHours.toFixed(2)} h`}
              />
            );
          })}
        </div>
      </div>

      <div className="meander" />

      {/* The arithmetic, in full. */}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          This month
        </h3>
        <div className="mt-2 divide-y" style={{ borderColor: "var(--border)" }}>
          <Row label="Container hours" hint={`${cost.containerHours.toFixed(2)} of 100 included`} value={cost.containerHours.toFixed(2)} />
          <Row label="Container awake ÷ useful exec" value={`${cost.awakeIndex.toFixed(2)}×`} />
          <Row label="Memory overage" value={usd(cost.usd.containerMemory)} />
          <Row label="Disk overage" value={usd(cost.usd.containerDisk)} />
          <Row label="CPU overage" value={usd(cost.usd.containerCpu)} />
          <Row label="DO duration + requests" value={usd(cost.usd.containers > 0 ? cost.usd.total - cost.usd.base - cost.usd.containers : 0)} />
          <Row label="Workers Paid base" value={usd(cost.usd.base, 2)} />
          <Row label="Total" value={usd(cost.usd.total, 2)} strong />
        </div>
      </div>

      <div className="rounded-md border px-3 py-2 text-[11px]" style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--muted)" }}>
        <span className="mono" style={{ color: "var(--muted)" }}>
          Tier-3 duty {pct(cost.containerHours / 3000)}.
        </span>{" "}
        The $5 base absorbs {pct(100 / 3000)}. Everything above that is the overage on this panel, and it is the honest number.
      </div>
    </div>
  );
}
