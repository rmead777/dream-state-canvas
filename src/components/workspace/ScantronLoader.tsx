/**
 * ScantronLoader — self-contained extraction of Sherpa's "scantron" loading indicator.
 *
 * This is the animation that appears in the chat rail while Sherpa is reasoning.
 * It reads like an optical-scan (Scantron) test sheet being read by a machine:
 * a horizontal light bar sweeps top-to-bottom over a grid of pulsing "bubble"
 * bars, while an orbital spinner and a row of progress dots indicate activity.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ORIGINAL SOURCE (this file is a portable, dependency-free copy of it):
 *   • JSX markup .......... src/components/workspace/SherpaRail.tsx  (lines 780–829,
 *                           rendered when `isProcessing` is true)
 *   • @keyframes .......... src/index.css
 *                             - scanline      (line 231) — the vertical sweep
 *                             - progressDot   (line 238) — the 4 "bubbles"
 *                             - dataStream    (line 243) — the 18-bar bottom grid
 *                             - materialize   (line 94)  — entrance transition
 *                             - spin / pulse  — Tailwind built-ins (orbital rings)
 *   • Color token ......... --workspace-accent: 234 60% 60%  (src/index.css line 31)
 *
 * The original relies on Tailwind utility classes + the global index.css stylesheet
 * + the `--workspace-accent` design token. This extracted version inlines ALL of
 * those into a scoped <style> block and plain inline styles, so it has ZERO external
 * dependencies — drop it into any React project and it just works.
 *
 * Usage:
 *   {isProcessing && <ScantronLoader />}
 *   <ScantronLoader label="Reasoning" sublabel="Sherpa is analyzing your workspace" />
 *   <ScantronLoader accent="14 90% 55%" />   // re-theme via HSL triplet
 * ──────────────────────────────────────────────────────────────────────────
 */

interface ScantronLoaderProps {
  /** Bold label shown next to the spinner. */
  label?: string;
  /** Smaller secondary line under the label. */
  sublabel?: string;
  /**
   * Accent color as a raw HSL triplet (no `hsl()` wrapper, no commas),
   * matching the original `--workspace-accent` token format: "H S% L%".
   */
  accent?: string;
}

export function ScantronLoader({
  label = 'Reasoning',
  sublabel = 'Sherpa is analyzing your workspace',
  accent = '234 60% 60%',
}: ScantronLoaderProps) {
  // Scope the accent token to this component so it can be re-themed per instance
  // without touching any global stylesheet. Every color below reads from it.
  const styleVars = { ['--scantron-accent' as string]: accent } as React.CSSProperties;

  return (
    <>
      {/* ── All keyframes + scoped classes, inlined so there are no external deps ── */}
      <style>{CSS}</style>

      <div
        className="scantron"
        role="status"
        aria-label="Loading"
        style={styleVars}
      >
        {/* Horizontal scan line that sweeps top → bottom (the "scanner head") */}
        <div className="scantron__scanline" />

        {/* 18-bar data stream pinned to the bottom edge — the rows being read.
            Each bar runs the same loop offset by a stagger so the grid ripples. */}
        <div className="scantron__stream">
          {Array.from({ length: 18 }).map((_, i) => (
            <div
              key={i}
              className="scantron__streambar"
              style={{ animationDelay: `${i * 0.11}s` }}
            />
          ))}
        </div>

        <div className="scantron__row">
          {/* Orbital spinner: two counter-rotating rings + a pulsing core */}
          <div className="scantron__orbit">
            <div className="scantron__ring scantron__ring--outer">
              <div className="scantron__satellite scantron__satellite--top" />
            </div>
            <div className="scantron__ring scantron__ring--inner">
              <div className="scantron__satellite scantron__satellite--bottom" />
            </div>
            <div className="scantron__core" />
          </div>

          {/* Label + the 4 progress "bubbles" that fill left-to-right */}
          <div className="scantron__meta">
            <div className="scantron__labelrow">
              <span className="scantron__label">{label}</span>
              <div className="scantron__dots">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="scantron__dot"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
            <p className="scantron__sublabel">{sublabel}</p>
          </div>
        </div>
      </div>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Scoped stylesheet. Mirrors the original Tailwind classes + index.css keyframes
 * 1:1. `--scantron-accent` is the only external knob (defaults set on .scantron).
 * ──────────────────────────────────────────────────────────────────────────── */
const CSS = `
.scantron {
  --scantron-accent: 234 60% 60%;
  position: relative;
  overflow: hidden;
  border-radius: 1rem;
  border: 1px solid hsl(var(--scantron-accent) / 0.30);
  background: linear-gradient(
    135deg,
    hsl(var(--scantron-accent) / 0.13),
    hsl(var(--scantron-accent) / 0.06),
    hsl(var(--scantron-accent) / 0.13)
  );
  padding: 0.75rem 1rem;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.85),
    0 12px 32px hsl(var(--scantron-accent) / 0.20);
  animation: scantron-materialize 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

/* The scanner head sweeping vertically */
.scantron__scanline {
  pointer-events: none;
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(
    to right,
    transparent,
    hsl(var(--scantron-accent) / 0.55),
    transparent
  );
  animation: scantron-scanline 2s linear infinite;
}

/* Bottom-edge grid of "rows" being read */
.scantron__stream {
  pointer-events: none;
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  height: 2px;
  gap: 1px;
  overflow: hidden;
  border-bottom-left-radius: 1rem;
  border-bottom-right-radius: 1rem;
}
.scantron__streambar {
  flex: 1 1 0%;
  background: hsl(var(--scantron-accent) / 0.20);
  animation: scantron-dataStream 2s linear infinite;
}

.scantron__row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* Orbital spinner */
.scantron__orbit {
  position: relative;
  height: 1.75rem;
  width: 1.75rem;
  flex-shrink: 0;
}
.scantron__ring {
  position: absolute;
  border-radius: 9999px;
}
.scantron__ring--outer {
  inset: 0;
  border: 1px solid hsl(var(--scantron-accent) / 0.30);
  animation: scantron-spin 2.5s linear infinite;
}
.scantron__ring--inner {
  inset: 0.25rem;
  border: 1px solid hsl(var(--scantron-accent) / 0.15);
  animation: scantron-spin 1.8s linear infinite reverse;
}
.scantron__satellite {
  position: absolute;
  left: 50%;
  border-radius: 9999px;
  background: hsl(var(--scantron-accent));
}
.scantron__satellite--top {
  top: 0;
  transform: translate(-50%, -1px);
  height: 0.375rem;
  width: 0.375rem;
}
.scantron__satellite--bottom {
  bottom: 0;
  transform: translate(-50%, 1px);
  height: 0.25rem;
  width: 0.25rem;
  background: hsl(var(--scantron-accent) / 0.65);
}
.scantron__core {
  position: absolute;
  inset: 0.625rem;
  border-radius: 9999px;
  background: hsl(var(--scantron-accent) / 0.20);
  animation: scantron-pulse 1.5s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

/* Label + progress bubbles */
.scantron__meta {
  flex: 1 1 0%;
  min-width: 0;
}
.scantron__labelrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.scantron__label {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.025em;
  color: hsl(var(--scantron-accent));
}
.scantron__dots {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.scantron__dot {
  height: 0.25rem;
  width: 0.75rem;
  border-radius: 9999px;
  background: hsl(var(--scantron-accent) / 0.45);
  animation: scantron-progressDot 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}
.scantron__sublabel {
  margin: 0.125rem 0 0;
  font-size: 0.625rem;
  line-height: 1rem;
  color: hsl(var(--scantron-accent) / 0.65);
}

/* ── Keyframes (ported verbatim from src/index.css) ── */
@keyframes scantron-materialize {
  from { opacity: 0; transform: scale(0.96) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes scantron-scanline {
  0%   { top: -2px; opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}
@keyframes scantron-progressDot {
  0%, 100% { opacity: 0.2; transform: scaleX(1); }
  50%      { opacity: 1; transform: scaleX(1.8); background: hsl(var(--scantron-accent)); }
}
@keyframes scantron-dataStream {
  0%, 100% { opacity: 0.1; transform: scaleY(1); }
  50%      { opacity: 0.6; transform: scaleY(2); background: hsl(var(--scantron-accent) / 0.5); }
}
/* Tailwind built-ins the original relied on, reproduced here */
@keyframes scantron-spin {
  to { transform: rotate(360deg); }
}
@keyframes scantron-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.5; }
}

@media (prefers-reduced-motion: reduce) {
  .scantron,
  .scantron__scanline,
  .scantron__streambar,
  .scantron__ring,
  .scantron__core,
  .scantron__dot {
    animation: none !important;
  }
}
`;

export default ScantronLoader;
