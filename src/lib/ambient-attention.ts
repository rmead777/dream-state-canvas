/**
 * ambient-attention — passive behavioral signal accumulator.
 *
 * Tracks three attention signals that feed the next-moves ranker:
 *   1. Cursor dwell — which cards does the user hover on, and for how long?
 *   2. Scroll-back count — how often does the user scroll up to review prior context?
 *   3. Query refinement rate — how many queries/min in the last window (exploration intensity)?
 *
 * All state is module-level so signals accumulate across the full browser session
 * without React lifecycle interference. The hook reads/writes here; the ranker
 * reads via getAttentionSignals().
 */

// ─── Dwell tracking ──────────────────────────────────────────────────────────

const dwellMs: Record<string, number> = {};
let activeHover: { id: string; startedAt: number } | null = null;

const DWELL_THRESHOLD_MS = 4_000; // 4 seconds → "high dwell"

export function recordHoverStart(objectId: string): void {
  if (activeHover) flushHover();
  activeHover = { id: objectId, startedAt: Date.now() };
}

export function recordHoverEnd(): void {
  flushHover();
}

function flushHover(): void {
  if (!activeHover) return;
  const elapsed = Date.now() - activeHover.startedAt;
  dwellMs[activeHover.id] = (dwellMs[activeHover.id] ?? 0) + elapsed;
  activeHover = null;
}

export function getHighDwellObjectIds(): string[] {
  flushHover(); // include in-flight hover
  return Object.entries(dwellMs)
    .filter(([, ms]) => ms >= DWELL_THRESHOLD_MS)
    .map(([id]) => id);
}

// ─── Scroll-back tracking ─────────────────────────────────────────────────────

let scrollBackCount = 0;

export function recordScrollBack(): void {
  scrollBackCount += 1;
}

export function getScrollBackCount(): number {
  return scrollBackCount;
}

// ─── Query refinement velocity ────────────────────────────────────────────────

const QUERY_WINDOW_MS = 5 * 60_000; // 5-minute sliding window
const queryTimestamps: number[] = [];

export function recordQuery(): void {
  const now = Date.now();
  queryTimestamps.push(now);
  // Keep only the last 60 entries to bound memory
  if (queryTimestamps.length > 60) queryTimestamps.shift();
}

export function getQueryRefinementRate(): number {
  const now = Date.now();
  const cutoff = now - QUERY_WINDOW_MS;
  const recent = queryTimestamps.filter((t) => t >= cutoff);
  if (recent.length < 2) return 0;
  // queries per minute in the window
  return (recent.length / (QUERY_WINDOW_MS / 60_000));
}

// ─── Snapshot for ranker ──────────────────────────────────────────────────────

export interface AttentionSignals {
  highDwellObjectIds: string[];
  scrollBackCount: number;
  queryRefinementRate: number;
}

export function getAttentionSignals(): AttentionSignals {
  return {
    highDwellObjectIds: getHighDwellObjectIds(),
    scrollBackCount: getScrollBackCount(),
    queryRefinementRate: getQueryRefinementRate(),
  };
}
