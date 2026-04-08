/**
 * useAnimationTimeline — shared hook for animated visualizations.
 *
 * Provides elapsed time since mount, progress calculators, stagger delays,
 * and prefers-reduced-motion detection. Used by both Three.js scenes
 * (via useFrame) and DOM-based animations (via RAF).
 */

import { useEffect, useRef, useState, useCallback } from 'react';

const REDUCED_MOTION = typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Cubic out easing — fast start, decelerating finish. Matches MetricDetail pattern. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Spring-like overshoot easing — slight bounce past target then settle. */
export function easeOutSpring(t: number): number {
  if (t >= 1) return 1;
  return 1 + 0.15 * Math.sin(t * Math.PI) * (1 - t);
}

/**
 * Calculate stagger delay for item at index.
 * Total stagger spread = stagger * (total - 1), each item offset by stagger * index.
 */
export function getStaggerDelay(index: number, stagger: number = 0.08): number {
  return index * stagger;
}

/**
 * DOM-based animation timeline for CSS + RAF animations.
 * Returns elapsed seconds since mount and a progress helper.
 */
export function useAnimationTimeline() {
  const startRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (REDUCED_MOTION) {
      setElapsed(999); // snap to "complete" state
      return;
    }

    startRef.current = performance.now();

    const tick = () => {
      const now = performance.now();
      setElapsed((now - startRef.current) / 1000);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  /** Get 0→1 progress for a given duration, optionally offset by delay. */
  const progress = useCallback((duration: number, delay: number = 0): number => {
    if (REDUCED_MOTION) return 1;
    const t = Math.max(0, elapsed - delay) / duration;
    return Math.min(1, t);
  }, [elapsed]);

  return { elapsed, progress, reducedMotion: REDUCED_MOTION };
}

/**
 * Three.js animation state — used inside useFrame.
 * Returns elapsed seconds since the component mounted.
 * Does NOT use React state (no re-renders) — read .current in useFrame.
 */
export function useThreeTimeline() {
  const startRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);

  const update = (clock: { getElapsedTime: () => number }) => {
    if (REDUCED_MOTION) {
      elapsedRef.current = 999;
      return;
    }
    if (startRef.current === null) {
      startRef.current = clock.getElapsedTime();
    }
    elapsedRef.current = clock.getElapsedTime() - startRef.current;
  };

  const progress = (duration: number, delay: number = 0): number => {
    if (REDUCED_MOTION) return 1;
    const t = Math.max(0, elapsedRef.current - delay) / duration;
    return Math.min(1, t);
  };

  return { elapsedRef, update, progress, reducedMotion: REDUCED_MOTION };
}
