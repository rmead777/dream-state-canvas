/**
 * Next Moves Ranker — scores the catalog against live workspace signals
 * and returns the top N most relevant suggestions.
 *
 * Scoring model:
 *   score = baseWeight
 *         + Σ signal_weights (time, card, query, etc.)
 *         + favoritesBonus (huge — pinned items always rise)
 *         + criticalTriggerBoost (hard gate — can slam to #1)
 *
 * Entries that require missing integrations are filtered OUT entirely.
 * Favorites get a large additive bonus so they anchor the top slots.
 * Critical triggers can override ranking and push an entry to #1.
 *
 * Pure functions — no side effects, no React. Easily testable.
 */

import type { WorkspaceObject, ActiveContext } from './workspace-types';
import type { NextMoveEntry, IntegrationDependency } from './next-moves-catalog';
import type { AttentionSignals } from './ambient-attention';
import { NEXT_MOVES_CATALOG } from './next-moves-catalog';

// ─── Signal Weights ─────────────────────────────────────────────────────────

const SIGNAL_WEIGHTS = {
  timeOfDayMatch: 4,
  dayOfWeekMatch: 2,
  focusedCardMatch: 5,
  recentQueryKeywordMatch: 3,
  favoriteAnchor: 100,      // favorites anchor — shown first unless a critical trigger overrides
  criticalTriggerActive: 1000, // slam to top
  // ─── Ambient attention ───────────────────────────────────────────────────
  ambientDwellMatch: 15,    // card user hovered 4+ seconds → boost related entries
  ambientExploration: 8,    // high query rate → boost data-exploration entries
  ambientScrollBack: 5,     // scroll-back behavior → boost summary/brief entries
} as const;

// ─── Inputs ─────────────────────────────────────────────────────────────────

export interface RankerInputs {
  /** Current workspace object map — used for focused-card signals. */
  objects: Record<string, WorkspaceObject>;
  /** Active context — source of focusedObjectId + recentIntents. */
  activeContext: ActiveContext | undefined;
  /** Which integrations are currently available (connected + synced). */
  connections: {
    qb: boolean;
    ragic: boolean;
    email: boolean;
    documents: boolean;
  };
  /** IDs currently firing in the automation-trigger system. */
  activeTriggers: string[];
  /** User's pinned favorite IDs (from localStorage). */
  favoriteIds: string[];
  /** Optional time override (for tests). Defaults to Date.now(). */
  now?: Date;
  /** Passive behavioral signals from useAmbientAttention. Optional. */
  ambientAttention?: AttentionSignals;
}

export interface RankedEntry {
  entry: NextMoveEntry;
  score: number;
  isFavorite: boolean;
  isCritical: boolean;
  /** Debug trail of matching signals — handy when tuning. */
  reasons: string[];
}

// ─── Scorer ─────────────────────────────────────────────────────────────────

export function scoreCatalog(input: RankerInputs): RankedEntry[] {
  const now = input.now ?? new Date();
  const hour = now.getHours();
  const dow = now.getDay();

  const focusedType = input.activeContext?.focusedObjectId
    ? input.objects[input.activeContext.focusedObjectId]?.type
    : undefined;

  const recentQueryText = (input.activeContext?.recentIntents || [])
    .slice(-5)
    .map((i) => (i.query || '').toLowerCase())
    .join(' ');

  const scored: RankedEntry[] = [];

  for (const entry of NEXT_MOVES_CATALOG) {
    // ─── Hard filter: missing integrations ──────────────────────────────────
    const missing = (entry.signals.requiresIntegrations || []).filter(
      (dep: IntegrationDependency) => !input.connections[dep],
    );
    if (missing.length > 0) continue;

    const reasons: string[] = [];
    let score = entry.signals.baseWeight ?? 1;

    // ─── Time of day ────────────────────────────────────────────────────────
    if (entry.signals.hours && entry.signals.hours.includes(hour)) {
      score += SIGNAL_WEIGHTS.timeOfDayMatch;
      reasons.push(`hour ${hour}`);
    }

    // ─── Day of week ────────────────────────────────────────────────────────
    if (entry.signals.daysOfWeek && entry.signals.daysOfWeek.includes(dow)) {
      score += SIGNAL_WEIGHTS.dayOfWeekMatch;
      reasons.push(`dow ${dow}`);
    }

    // ─── Focused card relevance ─────────────────────────────────────────────
    if (
      focusedType &&
      entry.signals.relevantWhenFocused &&
      entry.signals.relevantWhenFocused.includes(focusedType)
    ) {
      score += SIGNAL_WEIGHTS.focusedCardMatch;
      reasons.push(`focused:${focusedType}`);
    }

    // ─── Recent query keyword match ─────────────────────────────────────────
    if (entry.signals.recentQueryKeywords) {
      for (const keyword of entry.signals.recentQueryKeywords) {
        if (recentQueryText.includes(keyword.toLowerCase())) {
          score += SIGNAL_WEIGHTS.recentQueryKeywordMatch;
          reasons.push(`kw:${keyword}`);
          break; // one match is enough
        }
      }
    }

    // ─── Ambient attention signals ───────────────────────────────────────────
    if (input.ambientAttention) {
      const { highDwellObjectIds, scrollBackCount, queryRefinementRate } = input.ambientAttention;

      // Dwell: if user hovered 4+ seconds on a card whose type this entry targets
      if (highDwellObjectIds.length > 0 && entry.signals.relevantWhenFocused) {
        const dwellTypes = highDwellObjectIds
          .map((id) => input.objects[id]?.type)
          .filter(Boolean);
        const matchesDwell = dwellTypes.some(
          (t) => entry.signals.relevantWhenFocused!.includes(t as WorkspaceObject['type'])
        );
        if (matchesDwell) {
          score += SIGNAL_WEIGHTS.ambientDwellMatch;
          reasons.push('dwell');
        }
      }

      // Exploration mode: high query refinement rate boosts data-query entries
      if (queryRefinementRate > 1.5 && entry.signals.recentQueryKeywords) {
        score += SIGNAL_WEIGHTS.ambientExploration;
        reasons.push(`explore:${queryRefinementRate.toFixed(1)}/min`);
      }

      // Scroll-back: user reviewing history → boost brief/summary entries
      if (scrollBackCount > 2 && (entry.id.includes('brief') || entry.id.includes('summary') || entry.id.includes('morning'))) {
        score += SIGNAL_WEIGHTS.ambientScrollBack;
        reasons.push('scroll-back');
      }
    }

    // ─── Favorites ──────────────────────────────────────────────────────────
    const isFavorite = input.favoriteIds.includes(entry.id);
    if (isFavorite) {
      score += SIGNAL_WEIGHTS.favoriteAnchor;
      reasons.push('★');
    }

    // ─── Critical triggers ──────────────────────────────────────────────────
    const firedCriticalTrigger =
      entry.signals.criticalTriggers &&
      entry.signals.criticalTriggers.some((t) => input.activeTriggers.includes(t));
    if (firedCriticalTrigger) {
      score += SIGNAL_WEIGHTS.criticalTriggerActive;
      reasons.push('🚨 critical');
    }

    scored.push({
      entry,
      score,
      isFavorite,
      isCritical: !!firedCriticalTrigger,
      reasons,
    });
  }

  // Sort descending by score; stable fallback on id for deterministic ties.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.id.localeCompare(b.entry.id);
  });

  return scored;
}

/**
 * Picks the top N for display. Ensures favorites anchor the first 2 slots
 * unless a critical trigger beats them.
 */
export function pickTopN(ranked: RankedEntry[], n: number): RankedEntry[] {
  return ranked.slice(0, n);
}

/**
 * Convenience: run the full pipeline and get top N entries.
 */
export function rankNextMoves(input: RankerInputs, n: number): RankedEntry[] {
  return pickTopN(scoreCatalog(input), n);
}

// ─── Favorites persistence ──────────────────────────────────────────────────

const FAVORITES_KEY = 'sherpa-next-moves-favorites-v1';

export function loadFavorites(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export function saveFavorites(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    // localStorage full or disabled — silently skip
  }
}

export function toggleFavorite(id: string): string[] {
  const current = loadFavorites();
  const next = current.includes(id)
    ? current.filter((x) => x !== id)
    : [...current, id];
  saveFavorites(next);
  return next;
}
