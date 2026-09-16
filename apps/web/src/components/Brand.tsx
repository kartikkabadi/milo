/**
 * Brand primitives, as components.
 *
 * The SVG paths here are the same two shapes as brand/mark.svg. They are
 * duplicated as components rather than fetched as files so the mark inherits
 * `currentColor` and costs no request. brand.md is the source of truth for the
 * geometry; if the two ever disagree, brand.md wins and this file is wrong.
 */

import { useEffect, useRef, useState } from "react";
import type { SessionStatus } from "../lib/types";

/** The mark. Two shapes, currentColor, 32 grid. */
export function Mark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="milo"
      fill="none"
      stroke="currentColor"
    >
      <path d="M8 7.5 Q16.5 11 25 7.5" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M14 15 V20 L17.5 20 V25 M14 18 L21.5 13 M21.5 13 h0.01"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The wordmark. Strokes, not a font. Never locked up with the mark. */
export function Wordmark({ height = 24, className = "" }: { height?: number; className?: string }) {
  const width = (height * 60) / 32;
  return (
    <svg
      viewBox="0 0 60 32"
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label="milo"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 26 V17 C3 13.2 5.5 12 7.75 12 C10 12 12.5 13.2 12.5 17 V26" />
      <path d="M12.5 17 C12.5 13.2 15 12 17.25 12 C19.5 12 22 13.2 22 17 V26" />
      <path d="M28 13 V26 M28 8 h0.01" />
      <path d="M35.5 6 V26" />
      <circle cx="50" cy="19" r="7" />
    </svg>
  );
}

/** A 2px meander divider. The Greek key, as a signature and not a costume. */
export function Meander({ className = "" }: { className?: string }) {
  return <div className={`meander ${className}`} role="separator" aria-hidden="true" />;
}

const RING_CIRCUMFERENCE = 2 * Math.PI * 22;

/**
 * The sleep/wake ring.
 *
 * Closes when the agent sleeps, opens when it wakes. This motion is
 * theme-independent — it lives in every theme, and it is the one piece of
 * motion the brand owns.
 *
 * Reduced motion is honoured: the ring still changes state, it just does not
 * animate the transition. A status that only exists as an animation is a
 * status that does not exist for some people.
 */
export function SleepWakeRing({
  status,
  size = 56,
  label,
}: {
  status: SessionStatus | "connecting";
  size?: number;
  label?: string;
}) {
  const asleep = status === "sleeping" || status === "idle";
  const busy = status === "thinking" || status === "reading" || status === "editing" || status === "testing" || status === "snapshotting" || status === "waking";
  const waiting = status === "awaiting-approval";
  const [dash, setDash] = useState(asleep ? RING_CIRCUMFERENCE : 0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const target = asleep ? RING_CIRCUMFERENCE : 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDash(target);
      return;
    }
    const start = performance.now();
    const from = dash;
    const dur = 420;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      // Ease out cubic. Slow at the end, so "closing" reads as settling.
      const eased = 1 - Math.pow(1 - t, 3);
      setDash(from + (target - from) * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asleep]);

  const stroke = waiting ? "var(--danger)" : busy ? "var(--accent)" : asleep ? "var(--border-accent)" : "var(--accent)";

  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 56 56" className="milo-ring-track" aria-hidden="true">
        {/* Track. Always present, very faint. */}
        <circle cx="28" cy="28" r="22" fill="none" stroke="var(--border)" strokeWidth="2" opacity="0.6" />
        {/* The ring itself. */}
        <circle
          cx="28"
          cy="28"
          r="22"
          fill="none"
          stroke={stroke}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={dash}
          transform="rotate(-90 28 28)"
        />
        {/* The mark, scaled into the ring. */}
        <g transform="translate(28 28) scale(0.62) translate(-16 -16)" color={stroke}>
          <path d="M8 7.5 Q16.5 11 25 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path
            d="M14 15 V20 L17.5 20 V25 M14 18 L21.5 13 M21.5 13 h0.01"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>
      <span className="sr-only">{label ?? `session ${status}`}</span>
    </div>
  );
}
