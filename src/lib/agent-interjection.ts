/**
 * Agent Interjection — module-level mailbox for steering an in-flight agent loop.
 *
 * The user can push interjections (free text) or request a hard stop while
 * the agent is iterating. The agent loop drains the queue at the start of
 * each iteration and injects pending interjections as user-role messages
 * with a clear "USER INTERJECTION:" prefix so the model treats them as
 * authoritative steering signals.
 *
 * Module-level state is intentional — only one agent loop runs at a time
 * (orchestratorLoop spawns parallel workers but they share this state),
 * and React state would couple the composer to a context tree it doesn't
 * need to know about.
 *
 * Lifecycle:
 *   1. agent-loop calls reset() at loop_start
 *   2. UI composer pushes interjections / requestStop() while loop is live
 *   3. agent-loop drains + checks at iteration boundaries
 *   4. agent-loop calls reset() again after loop_complete
 */

const interjections: string[] = [];
let stopRequested = false;
let stopReason: string | null = null;

/** Push a user-typed interjection into the queue. Multiple are allowed. */
export function pushInterjection(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  interjections.push(trimmed);
}

/** Drain all pending interjections (called by the agent loop). */
export function drainInterjections(): string[] {
  if (interjections.length === 0) return [];
  return interjections.splice(0);
}

/** Are any interjections waiting? Used by UI to show "queued" indicator. */
export function pendingInterjectionCount(): number {
  return interjections.length;
}

/** Request the loop to stop at its next iteration boundary. */
export function requestStop(reason: string = 'User requested stop'): void {
  stopRequested = true;
  stopReason = reason;
}

export function isStopRequested(): boolean {
  return stopRequested;
}

export function getStopReason(): string | null {
  return stopReason;
}

/** Called by the agent loop at loop_start and loop_complete. */
export function resetInterjectionState(): void {
  interjections.length = 0;
  stopRequested = false;
  stopReason = null;
}
