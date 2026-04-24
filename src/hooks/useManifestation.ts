/**
 * useManifestation — phase-driven visual state for a workspace card.
 *
 * Reads the card's `manifestationPhase` and returns pre-computed visual
 * primitives (opacity, blur, scale, glow) plus an inline style you spread
 * onto the card wrapper. Composes with the existing `animate-[materialize_...]`
 * path: when manifestationPhase is undefined, the hook returns `{ active: false }`
 * and the caller keeps its current render.
 *
 * Composes with `useAnimationTimeline` so it participates in the existing
 * `prefers-reduced-motion` handling.
 */

import { useEffect, useRef } from 'react';
import type { WorkspaceObject } from '@/lib/workspace-types';
import type { ManifestationPhase } from '@/lib/manifestation-types';
import { PHASE_MIN_MS, nextPhase } from '@/lib/manifestation-types';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAnimationTimeline } from './useAnimationTimeline';

export interface ManifestationVisuals {
  /** True iff manifestationPhase is set on the object. */
  active: boolean;
  phase: ManifestationPhase | null;
  /** 0–1 — the outer card surface (glass). Low during scaffold. */
  surfaceOpacity: number;
  /** px — blur applied to the content layer. Heavy during scaffold. */
  contentBlur: number;
  /** 0–1 — content layer opacity (skeletons + real content). */
  contentOpacity: number;
  /** Scale factor — slight overshoot at actions-ready, back to 1 at settled. */
  scale: number;
  /** 0–1 — intensity of the accent glow ring around the card. */
  glow: number;
  /** Convenience inline-style object you spread onto the wrapper. */
  style: React.CSSProperties;
  /** True when phase is scaffold/resolving — show skeleton, hide real content. */
  showSkeleton: boolean;
}

const INACTIVE: ManifestationVisuals = {
  active: false,
  phase: null,
  surfaceOpacity: 1,
  contentBlur: 0,
  contentOpacity: 1,
  scale: 1,
  glow: 0,
  style: {},
  showSkeleton: false,
};

/** Per-phase target visual values. */
const PHASE_TARGETS: Record<
  ManifestationPhase,
  Omit<ManifestationVisuals, 'active' | 'phase' | 'style' | 'showSkeleton'>
> = {
  scaffold: {
    surfaceOpacity: 0.35,
    contentBlur: 12,
    contentOpacity: 0,
    scale: 0.96,
    glow: 0.9,
  },
  resolving: {
    surfaceOpacity: 0.78,
    contentBlur: 4,
    contentOpacity: 0.35,
    scale: 0.99,
    glow: 0.55,
  },
  hydrating: {
    surfaceOpacity: 1,
    contentBlur: 0,
    contentOpacity: 1,
    scale: 1.0,
    glow: 0.35,
  },
  'actions-ready': {
    surfaceOpacity: 1,
    contentBlur: 0,
    contentOpacity: 1,
    scale: 1.012, // small overshoot
    glow: 0.45,
  },
  settled: {
    surfaceOpacity: 1,
    contentBlur: 0,
    contentOpacity: 1,
    scale: 1.0,
    glow: 0,
  },
};

/**
 * Hook — returns visual state for an object's current manifestation phase.
 *
 * Advance rules:
 *   scaffold         — EVENT-DRIVEN. Held indefinitely until handleCreate
 *                      (in useWorkspaceActions) dispatches 'resolving' when
 *                      real content arrives. This is the whole point: a slow
 *                      agent loop holds the scaffold visible, not a spinner.
 *   resolving → hyd. — auto-advance after floor (brief visual clear).
 *   hydrating → act. — auto-advance after floor (content painted).
 *   actions-ready    — auto-advance after floor (settles).
 *   settled          — terminal; reducer flips status to 'open' + clears phase.
 */
export function useManifestation(object: WorkspaceObject): ManifestationVisuals {
  const { dispatch } = useWorkspace();
  const { reducedMotion } = useAnimationTimeline();
  const lastAdvancedAt = useRef<number>(0);
  const phaseEnteredAtRef = useRef<{ phase: ManifestationPhase | null; at: number }>({
    phase: null,
    at: 0,
  });

  const phase = object.manifestationPhase ?? null;

  // Track phase-entry time (useful for debug + future event correlation).
  useEffect(() => {
    if (phaseEnteredAtRef.current.phase !== phase) {
      phaseEnteredAtRef.current = { phase, at: Date.now() };
    }
  }, [phase]);

  // Auto-advance the non-scaffold phases. scaffold is held for the agent.
  useEffect(() => {
    if (!phase) return;
    if (phase === 'scaffold') return; // purely event-driven
    if (reducedMotion) {
      dispatch({
        type: 'ADVANCE_MANIFESTATION_PHASE',
        payload: { id: object.id, phase: 'settled' },
      });
      return;
    }
    const next = nextPhase(phase);
    if (!next) return;
    const floor = PHASE_MIN_MS[phase];
    // Tiny minimum so a 0-floor phase still gets a frame to paint.
    const delay = Math.max(16, floor);
    const timer = window.setTimeout(() => {
      lastAdvancedAt.current = Date.now();
      dispatch({
        type: 'ADVANCE_MANIFESTATION_PHASE',
        payload: { id: object.id, phase: next },
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [phase, object.id, dispatch, reducedMotion]);

  if (!phase) return INACTIVE;

  const targets = PHASE_TARGETS[phase];
  const style: React.CSSProperties = {
    opacity: targets.surfaceOpacity,
    transform: `scale(${targets.scale})`,
    boxShadow: `0 0 ${12 + targets.glow * 40}px hsl(234 60% 60% / ${targets.glow * 0.3})`,
    transition:
      'opacity 220ms var(--workspace-motion-swift), ' +
      'transform 280ms var(--workspace-motion-spring), ' +
      'box-shadow 260ms var(--workspace-motion-swift)',
  };

  return {
    active: true,
    phase,
    ...targets,
    style,
    showSkeleton: phase === 'scaffold' || phase === 'resolving',
  };
}
