/**
 * Memory Detector — detects implicit learning signals from user behavior.
 *
 * Runs AFTER each intent is processed, comparing the current action to
 * recent history to identify corrections, anti-patterns, and workflow sequences.
 * All detections create low-confidence inferred memories that require
 * confirmation before reaching Tier 2.
 */
import { WorkspaceAction, WorkspaceObject, ObjectType } from './workspace-types';
import { createMemory } from './memory-store';
import { supabase } from '@/integrations/supabase/client';

interface ActionRecord {
  action: WorkspaceAction;
  query: string;
  timestamp: number;
}

// Rolling buffer of recent actions for pattern detection
let recentActions: ActionRecord[] = [];
const MAX_ACTION_HISTORY = 20;

export function recordAction(record: ActionRecord): void {
  recentActions.push(record);
  if (recentActions.length > MAX_ACTION_HISTORY) {
    recentActions = recentActions.slice(-MAX_ACTION_HISTORY);
  }
}

/**
 * Detect learning signals by comparing the current action to recent history.
 * Call this AFTER each intent is processed. Non-blocking — errors are swallowed.
 */
export async function detectLearningSignals(
  currentQuery: string,
  currentAction: WorkspaceAction,
  _objects: Record<string, WorkspaceObject>
): Promise<void> {
  const now = Date.now();
  const previousRecord = recentActions[recentActions.length - 2]; // -1 is current
  if (!previousRecord) return;

  const timeSinceLast = now - previousRecord.timestamp;

  // ─── Signal 1: Rapid Dissolution (anti-pattern) ─────────────────────────
  // User creates something and dissolves it within 15 seconds
  if (
    currentAction.type === 'dissolve' &&
    previousRecord.action.type === 'create' &&
    timeSinceLast < 15000
  ) {
    const prevCreate = previousRecord.action;
    await createMemory({
      type: 'anti-pattern',
      trigger: {
        onQueryContains: extractKeywords(previousRecord.query),
        onAction: ['create'],
        onObjectType: [prevCreate.objectType],
      },
      content: `User quickly dissolved a "${prevCreate.objectType}" panel titled "${prevCreate.title}" after asking "${previousRecord.query}". This may not be what they want for similar queries.`,
      reasoning: `Detected rapid dissolution (${Math.round(timeSinceLast / 1000)}s) suggesting the materialized object didn't match user intent.`,
      confidence: 0.4,
      source: 'inferred',
      tags: ['auto-detected', 'rapid-dissolution', prevCreate.objectType],
    });
  }

  // ─── Signal 2: Correction Language ──────────────────────────────────────
  // User says "no", "not", "stop", "wrong", "I meant", etc.
  if (/\b(no|not|stop|wrong|don't|didn't mean|i meant|i said|that's not)\b/i.test(currentQuery)) {
    const prevQuery = previousRecord.query;
    const prevAction = previousRecord.action;

    await createMemory({
      type: 'correction',
      trigger: {
        onQueryContains: extractKeywords(prevQuery),
      },
      content: `When user said "${prevQuery}", Sherpa responded with "${prevAction.type}" but user corrected with "${currentQuery}". The original response was wrong.`,
      reasoning: `User explicitly corrected Sherpa's interpretation. Previous query: "${prevQuery}" → Action: ${prevAction.type}. Correction: "${currentQuery}". Sherpa should handle similar future queries differently.`,
      confidence: 0.7,
      source: 'inferred',
      tags: ['auto-detected', 'correction', prevAction.type],
    });
  }

  // ─── Signal 3: Workflow Sequence ────────────────────────────────────────
  if (recentActions.length >= 4) {
    await detectWorkflowPatterns();
  }
}

/**
 * Scan action history for repeated create-type sequences.
 * If action A → B happens 3+ times within 60s each, propose as workflow pattern.
 */
async function detectWorkflowPatterns(): Promise<void> {
  const createActions = recentActions
    .filter(r => r.action.type === 'create')
    .map(r => ({
      objectType: (r.action as { objectType: ObjectType }).objectType,
      timestamp: r.timestamp,
    }));

  const pairCounts = new Map<string, number>();
  for (let i = 0; i < createActions.length - 1; i++) {
    const pair = `${createActions[i].objectType}→${createActions[i + 1].objectType}`;
    const timeBetween = createActions[i + 1].timestamp - createActions[i].timestamp;
    if (timeBetween < 60000) {
      pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
    }
  }

  for (const [pair, count] of pairCounts) {
    if (count >= 3) {
      const [typeA, typeB] = pair.split('→');
      await createMemory({
        type: 'pattern',
        trigger: {
          onObjectType: [typeA as ObjectType],
          onAction: ['create'],
        },
        content: `User frequently creates a "${typeB}" object immediately after creating a "${typeA}" object. Consider proactively suggesting "${typeB}" when "${typeA}" is materialized.`,
        reasoning: `Detected ${count} occurrences of ${typeA} → ${typeB} sequence within 60 seconds each time.`,
        confidence: Math.min(0.5 + (count * 0.1), 0.85),
        source: 'inferred',
        tags: ['auto-detected', 'workflow', typeA, typeB],
      });
    }
  }
}

/** Extract meaningful keywords from a query for trigger matching */
function extractKeywords(query: string): string[] {
  const stopWords = new Set(['that', 'this', 'when', 'with', 'from', 'should', 'the', 'and', 'for', 'what', 'show', 'me']);
  return query.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
    .slice(0, 5);
}
