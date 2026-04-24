/**
 * Manifestation Controller — phases, MIN-duration floors, agent events.
 *
 * Binds the visual "intent-manifestation" choreography (scaffold → resolving
 * → hydrating → settled) to real events from the agent loop, not fixed timers.
 *
 * Design:
 *   - Cards manifest in sub-phases within the existing `status: 'materializing'`.
 *   - Phases advance on AGENT EVENTS (event-bound), with MIN-duration FLOORS
 *     for aesthetic coherence but NO CEILINGS. If Claude's still working, the
 *     scaffold waits.
 *   - Scaffolds can spawn during the agent loop (before real data arrives) by
 *     watching the agent's shadow-state mutations — this is how the user sees
 *     geometry form before content.
 *
 * This file is PURE TYPES + CONSTANTS. No React, no side effects.
 * Safe to import from anywhere (workspace-types, agent loop, hooks, components).
 */

import type { ObjectType } from './workspace-types';

// ─── Phases ─────────────────────────────────────────────────────────────────

/**
 * Sub-phases within the existing `status: 'materializing'` lifecycle.
 *
 *   scaffold      — geometry only; no content; strong glow + heavy blur
 *   resolving     — type + params known; surface still forming; medium blur
 *   hydrating     — real content arriving; surface resolved
 *   actions-ready — fully hydrated; buttons enable; slight overshoot
 *   settled       — at rest; manifestation complete (status flips to 'open')
 */
export type ManifestationPhase =
  | 'scaffold'
  | 'resolving'
  | 'hydrating'
  | 'actions-ready'
  | 'settled';

/**
 * MIN time (ms) a card must remain in each phase before advancing.
 * No ceilings — if the next event hasn't arrived, the card holds at
 * the current phase (scaffold can idle indefinitely on a slow loop).
 *
 * Tuned for the 700ms–1.8s total budget.
 */
export const PHASE_MIN_MS: Record<ManifestationPhase, number> = {
  scaffold: 180,        // structure-visible floor before content can appear
  resolving: 150,       // glass-settling floor
  hydrating: 0,         // purely event-driven — no artificial floor
  'actions-ready': 80,  // tiny beat before buttons become interactive
  settled: 0,
};

/**
 * Stagger between simultaneous scaffold spawns. When the agent creates
 * multiple cards off one prompt, the eye can track distinct arrivals at
 * ~120ms spacing — fast enough to feel like one gesture, slow enough to
 * read as plural.
 */
export const MULTI_SCAFFOLD_STAGGER_MS = 120;

// ─── Agent Loop Events ──────────────────────────────────────────────────────

/**
 * Events emitted by sherpa-agent's `onEvent` callback at meaningful moments
 * during the loop. These are SERVER-SIDE-OF-THE-CLIENT events — we're not
 * parsing Anthropic's SSE stream; we're emitting at decision points inside
 * the existing agent loop that the loop already knows about.
 *
 * Consumers: useWorkspaceActions (to dispatch scaffold cards + phase moves),
 * any telemetry overlay, optional ambient-field controller.
 */
export type AgentLoopEvent =
  | { type: 'loop_start'; query: string; t: number }
  | { type: 'iteration_start'; iteration: number; t: number }
  | {
      type: 'tool_executing';
      toolName: string;
      args: Record<string, unknown>;
      t: number;
    }
  | { type: 'tool_complete'; toolName: string; t: number }
  | {
      /**
       * The agent's shadow state got a new provisional card. The REAL card
       * won't be materialized until loop_complete, but we know enough now
       * to render a scaffold: id, type, title, and any explicit sources.
       */
      type: 'shadow_create';
      shadowId: string;
      objectType: ObjectType;
      title: string;
      /** IDs of existing cards this new card was derived from. */
      sourceObjectIds: string[];
      t: number;
    }
  | { type: 'shadow_update'; objectId: string; t: number }
  | { type: 'shadow_dissolve'; objectId: string; t: number }
  | { type: 'loop_complete'; t: number }
  | { type: 'loop_error'; message: string; t: number };

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Rank phases numerically for monotonic advance checks. Phases should only
 * move FORWARD during a single manifestation — a scaffold never regresses.
 */
const PHASE_ORDER: Record<ManifestationPhase, number> = {
  scaffold: 0,
  resolving: 1,
  hydrating: 2,
  'actions-ready': 3,
  settled: 4,
};

export function isPhaseAtLeast(
  current: ManifestationPhase,
  target: ManifestationPhase,
): boolean {
  return PHASE_ORDER[current] >= PHASE_ORDER[target];
}

export function nextPhase(current: ManifestationPhase): ManifestationPhase | null {
  switch (current) {
    case 'scaffold':
      return 'resolving';
    case 'resolving':
      return 'hydrating';
    case 'hydrating':
      return 'actions-ready';
    case 'actions-ready':
      return 'settled';
    case 'settled':
      return null;
  }
}
