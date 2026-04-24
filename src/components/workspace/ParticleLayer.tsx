/**
 * ParticleLayer — data-lineage particle bursts.
 *
 * When a scaffold card is spawned from existing source cards (via the
 * agent's shadow_create event carrying sourceObjectIds), this layer
 * animates particles flowing from each source's DOM position to the
 * new scaffold's position. Visualizes "this new card came from those."
 *
 * Listens for `sherpa-particle-burst` CustomEvent({ fromIds, toId }).
 * Target DOM elements are located via `data-workspace-object-id`, which
 * WorkspaceObjectWrapper sets on its root div. If the target hasn't
 * rendered yet (typical on first scaffold frame), the burst retries
 * up to 3 animation frames before giving up.
 *
 * Respects prefers-reduced-motion — does nothing if the user opted out.
 * Single shared <canvas> at top-level, pointer-events: none, so it
 * never interferes with clicks.
 */

import { useEffect, useRef } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface BurstDetail {
  fromIds: string[];
  toId: string;
}

interface Particle {
  // Cubic bezier control points (screen coords)
  x0: number; y0: number;  // start (source center)
  cx: number; cy: number;  // control (halfway + lateral jitter)
  x1: number; y1: number;  // end (target center)
  startedAt: number;
  duration: number;        // ms
  hue: number;             // HSL hue — slight per-particle variation
  size: number;            // base radius in px
}

// ─── Config ─────────────────────────────────────────────────────────────────

const PARTICLES_PER_SOURCE = 8;
const BASE_DURATION_MS = 820;
const DURATION_JITTER_MS = 220;
const SOURCE_ACCENT_HUE = 234; // matches workspace-accent

/** Ease-in-out cubic — same curve used across the workspace. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Cubic bezier interpolation along P0 → C → P1 (quadratic, really — we use
 *  a single control point for efficiency). */
function bez(t: number, p0: number, c: number, p1: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * c + t * t * p1;
}

function findCardCenter(id: string): { x: number; y: number } | null {
  const el = document.querySelector(`[data-workspace-object-id="${CSS.escape(id)}"]`);
  if (!el) return null;
  const rect = (el as HTMLElement).getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ParticleLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // ─── Resize canvas to viewport (account for DPR) ───────────────────────
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // ─── Spawn particles for a burst (with retry if target hasn't rendered) ─
    const spawnBurst = (detail: BurstDetail, retriesLeft: number) => {
      const targetCenter = findCardCenter(detail.toId);
      if (!targetCenter) {
        if (retriesLeft > 0) {
          requestAnimationFrame(() => spawnBurst(detail, retriesLeft - 1));
        }
        return;
      }
      const now = performance.now();
      for (const sourceId of detail.fromIds) {
        const sourceCenter = findCardCenter(sourceId);
        if (!sourceCenter) continue;

        for (let i = 0; i < PARTICLES_PER_SOURCE; i++) {
          // Midpoint with perpendicular jitter — particles arc rather than go straight
          const midX = (sourceCenter.x + targetCenter.x) / 2;
          const midY = (sourceCenter.y + targetCenter.y) / 2;
          const dx = targetCenter.x - sourceCenter.x;
          const dy = targetCenter.y - sourceCenter.y;
          const len = Math.hypot(dx, dy) || 1;
          // Perpendicular unit vector
          const px = -dy / len;
          const py = dx / len;
          const lateral = (Math.random() - 0.5) * Math.min(260, len * 0.45);

          particlesRef.current.push({
            x0: sourceCenter.x + (Math.random() - 0.5) * 20,
            y0: sourceCenter.y + (Math.random() - 0.5) * 20,
            cx: midX + px * lateral,
            cy: midY + py * lateral,
            x1: targetCenter.x + (Math.random() - 0.5) * 16,
            y1: targetCenter.y + (Math.random() - 0.5) * 16,
            startedAt: now + i * 18, // small stagger within a burst
            duration: BASE_DURATION_MS + Math.random() * DURATION_JITTER_MS,
            hue: SOURCE_ACCENT_HUE + (Math.random() - 0.5) * 24,
            size: 1.6 + Math.random() * 1.4,
          });
        }
      }
      ensureRaf();
    };

    const burstHandler = (e: Event) => {
      const detail = (e as CustomEvent<BurstDetail>).detail;
      if (!detail || !detail.toId || !detail.fromIds?.length) return;
      // Retry for up to 3 frames in case the target scaffold hasn't rendered yet
      spawnBurst(detail, 3);
    };
    window.addEventListener('sherpa-particle-burst', burstHandler);

    // ─── Render loop ────────────────────────────────────────────────────────
    const render = () => {
      const now = performance.now();
      const particles = particlesRef.current;

      // Clear only the area that had particles last frame — simpler: full clear
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      ctx.globalCompositeOperation = 'lighter';
      let alive = 0;
      for (const p of particles) {
        const elapsed = now - p.startedAt;
        if (elapsed < 0) { alive++; continue; }
        const t = elapsed / p.duration;
        if (t >= 1) continue;
        const eased = easeInOutCubic(t);
        const x = bez(eased, p.x0, p.cx, p.x1);
        const y = bez(eased, p.y0, p.cy, p.y1);

        // Size + alpha curve — bright in middle, fade at end
        const alpha = t < 0.15 ? t / 0.15 : 1 - ((t - 0.15) / 0.85) ** 2;
        const radius = p.size * (0.6 + 0.8 * Math.sin(t * Math.PI));

        // Glow halo
        const grad = ctx.createRadialGradient(x, y, 0, x, y, radius * 5);
        grad.addColorStop(0, `hsla(${p.hue}, 80%, 62%, ${alpha * 0.9})`);
        grad.addColorStop(0.5, `hsla(${p.hue}, 80%, 62%, ${alpha * 0.3})`);
        grad.addColorStop(1, `hsla(${p.hue}, 80%, 62%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, radius * 5, 0, Math.PI * 2);
        ctx.fill();

        // Bright core
        ctx.fillStyle = `hsla(${p.hue}, 95%, 75%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        alive++;
      }
      ctx.globalCompositeOperation = 'source-over';

      // Compact: drop completed particles periodically so the array doesn't grow
      if (alive < particles.length) {
        particlesRef.current = particles.filter((p) => now - p.startedAt < p.duration);
      }

      if (particlesRef.current.length > 0) {
        rafRef.current = requestAnimationFrame(render);
      } else {
        rafRef.current = null;
      }
    };

    const ensureRaf = () => {
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(render);
      }
    };

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('sherpa-particle-burst', burstHandler);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      particlesRef.current = [];
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[5]"
    />
  );
}
