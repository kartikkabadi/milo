/**
 * Theme menu.
 *
 * Seven themes, each with a preview dot pair, persisted, and resolved against
 * the system preference on first run.
 *
 * Forge Red is gated. Selecting it requires an explicit confirmation, because
 * it is a warning state and not a mood. A theme picker that lets you
 * accidentally make your whole workspace look like an error is a theme picker
 * that has failed at its one job.
 */

import { useEffect, useRef, useState } from "react";
import { applyTheme, persistTheme, resolveInitialTheme, themes, type ThemeMeta } from "../lib/themes";

function Dots({ theme }: { theme: ThemeMeta }) {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
      <span className="h-3 w-3 rounded-[3px] border" style={{ background: theme.swatch.bg, borderColor: "var(--border)" }} />
      <span className="h-3 w-3 rounded-full" style={{ background: theme.swatch.accent }} />
      <span className="h-3 w-3 rounded-full" style={{ background: theme.swatch.text }} />
    </span>
  );
}

export function ThemeMenu() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>(() => resolveInitialTheme());
  const [confirming, setConfirming] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applyTheme(active);
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirming(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (theme: ThemeMeta) => {
    if (theme.danger && active !== theme.id) {
      setConfirming(theme.id);
      return;
    }
    setActive(theme.id);
    persistTheme(theme.id);
    setConfirming(null);
    setOpen(false);
  };

  const current = themes.find((t) => t.id === active) ?? themes[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]"
        style={{ borderColor: "var(--border)" }}
      >
        <Dots theme={current} />
        <span className="hidden sm:inline">{current.label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="opacity-60">
          <path d="M2 4 L5 7 L8 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-lg border shadow-lg"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <div className="meander" />
          <ul className="py-1">
            {themes.map((theme) => (
              <li key={theme.id}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme.id === active}
                  onClick={() => choose(theme)}
                  className="flex w-full items-start gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-2)]"
                >
                  <span className="mt-0.5">
                    <Dots theme={theme} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{theme.label}</span>
                      {theme.defaultFor && (
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                          style={{ background: "var(--surface-2)", color: "var(--muted)" }}
                        >
                          {theme.defaultFor} default
                        </span>
                      )}
                      {theme.danger && (
                        <span className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide" style={{ background: "var(--danger)", color: "var(--background)" }}>
                          danger
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs" style={{ color: "var(--muted)" }}>
                      {theme.blurb}
                    </span>
                  </span>
                  {theme.id === active && (
                    <span className="mt-1" style={{ color: "var(--success)" }}>
                      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                        <path d="M3 7.5 L5.8 10.2 L11 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {confirming && (
            <div className="border-t px-3 py-3 text-xs" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
              <p style={{ color: "var(--danger)" }} className="font-medium">
                Forge Red is a warning theme.
              </p>
              <p className="mt-1" style={{ color: "var(--muted)" }}>
                It is reserved for destructive actions, bypassed approvals, and <code>--yolo</code> runs. Selecting it changes
                nothing about permissions — it only makes the danger visible.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActive(confirming);
                    persistTheme(confirming);
                    setConfirming(null);
                    setOpen(false);
                  }}
                  className="rounded px-2 py-1 font-medium"
                  style={{ background: "var(--danger)", color: "var(--background)" }}
                >
                  Use it anyway
                </button>
                <button type="button" onClick={() => setConfirming(null)} className="rounded px-2 py-1" style={{ color: "var(--muted)" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
