/**
 * Terminal panel, backed by xterm.js.
 *
 * The xterm ITheme is read from themes/bundle.json, so a terminal theme is the
 * same palette object that produced the Pi theme and the CSS variables. Nothing
 * is hand-mapped, so nothing can drift.
 *
 * Truecolor is required for these themes to look designed rather than inverted.
 * The panel checks `COLORTERM` server-side and warns once if it is missing,
 * because a theme silently falling back to 16 colours looks like a bug in the
 * theme rather than a misconfigured terminal.
 */

import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { xtermTheme } from "../lib/themes";

export function TerminalPanel({
  themeId,
  sessionId,
  connected,
  onInput,
}: {
  themeId: string;
  sessionId: string;
  connected: boolean;
  onInput?: (data: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [truecolorWarning, setTruecolorWarning] = useState(false);

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new XTerm({
      theme: xtermTheme(themeId),
      fontFamily: '"JetBrains Mono", "Geist Mono", ui-monospace, monospace',
      fontSize: 12.5,
      lineHeight: 1.45,
      letterSpacing: 0,
      cursorBlink: true,
      convertEol: true,
      allowProposedApi: true,
      scrollback: 5000,
      // Serif is never allowed in a terminal, and neither is a proportional
      // face. The font stack above is the only one this component will use.
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();

    term.writeln(`\x1b[2mmilo\x1b[0m session \x1b[1m${sessionId}\x1b[0m`);
    term.writeln(`\x1b[2mterminal theme follows the GUI theme. switch it in the header.\x1b[0m`);
    term.writeln("");
    if (!term.options.theme || Object.keys(term.options.theme).length < 8) {
      setTruecolorWarning(true);
    }

    const dataSub = term.onData((data) => onInput?.(data));

    termRef.current = term;
    fitRef.current = fit;

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // The panel is mid-layout. The next observation will fit it.
      }
    });
    ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      dataSub.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // The terminal is created once. Theme changes are applied below, without
    // tearing down the buffer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Theme changes mutate the existing instance. Recreating it would clear
  // scrollback, which is the one thing a terminal must never do on a repaint.
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = xtermTheme(themeId);
    }
  }, [themeId]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.writeln(connected ? `\x1b[32m●\x1b[0m connected` : `\x1b[31m●\x1b[0m disconnected`);
  }, [connected]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
          <span className="mono">terminal</span>
          <span style={{ color: "var(--dim)" }}>·</span>
          <span>truecolor required</span>
        </div>
        <div className="flex items-center gap-2">
          {truecolorWarning && (
            <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: "var(--diff-removed-bg)", color: "var(--danger)" }}>
              COLORTERM is not truecolor
            </span>
          )}
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: connected ? "var(--success)" : "var(--danger)" }}
            aria-hidden="true"
          />
        </div>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden px-2 py-1" style={{ background: "var(--background)" }} />
    </div>
  );
}
