/**
 * Memory Retriever — scores and selects the most relevant memories
 * for the current interaction context, then formats them for AI injection.
 *
 * Budget: 8-12 memories max, 1500-2500 tokens total.
 * Corrections always get priority (they prevent known mistakes).
 */
import { SherpaMemory, MemoryTrigger, WorkspaceStateCondition } from './memory-types';
import { ObjectType, WorkspaceActionType, WorkspaceState } from './workspace-types';
import { getMemories, recordHit } from './memory-store';

export interface RetrievalContext {
  query: string;
  objectTypes: ObjectType[];
  pendingAction?: WorkspaceActionType;
  workspaceState: WorkspaceStateCondition;
}

/**
 * Score how relevant a memory is to the current context. Returns 0-1.
 */
function scoreRelevance(memory: SherpaMemory, ctx: RetrievalContext): number {
  const trigger = memory.trigger;
  let score = 0;
  let matchCount = 0;
  let triggerCount = 0;

  // Always-on memories get base relevance
  if (trigger.always) return 0.8 + (memory.confidence * 0.2);

  // Keyword match
  if (trigger.onQueryContains && trigger.onQueryContains.length > 0) {
    triggerCount++;
    const queryLower = ctx.query.toLowerCase();
    const matches = trigger.onQueryContains.filter(kw => queryLower.includes(kw.toLowerCase()));
    if (matches.length > 0) {
      score += matches.length / trigger.onQueryContains.length;
      matchCount++;
    }
  }

  // Object type match
  if (trigger.onObjectType && trigger.onObjectType.length > 0) {
    triggerCount++;
    const overlap = trigger.onObjectType.filter(t => ctx.objectTypes.includes(t));
    if (overlap.length > 0) {
      score += overlap.length / trigger.onObjectType.length;
      matchCount++;
    }
  }

  // Action match
  if (trigger.onAction && ctx.pendingAction) {
    triggerCount++;
    if (trigger.onAction.includes(ctx.pendingAction)) {
      score += 1;
      matchCount++;
    }
  }

  // Workspace state match
  if (trigger.onWorkspaceState && trigger.onWorkspaceState === ctx.workspaceState) {
    triggerCount++;
    score += 1;
    matchCount++;
  }

  // No triggers matched at all
  if (triggerCount > 0 && matchCount === 0) return 0;

  // Empty trigger (shouldn't happen but safety)
  if (triggerCount === 0) return 0.1;

  // Normalize and weight by confidence
  const normalizedScore = score / Math.max(triggerCount, 1);
  return normalizedScore * 0.7 + memory.confidence * 0.3;
}

/**
 * Determine the current workspace state condition.
 */
export function determineWorkspaceState(state: WorkspaceState): WorkspaceStateCondition {
  const activeObjects = Object.values(state.objects).filter(o => o.status !== 'dissolved');
  if (activeObjects.length === 0) return 'empty';
  if (state.activeContext.immersiveObjectId) return 'immersive';
  if (activeObjects.some(o => o.type === 'alert')) return 'has-alerts';
  if (activeObjects.some(o => o.type === 'dataset')) return 'has-dataset';
  return 'empty'; // fallback — no special state
}

/**
 * Retrieve the most relevant memories for the current interaction.
 * Corrections always get priority. Non-blocking on failure.
 */
export async function retrieveRelevantMemories(
  userId: string,
  ctx: RetrievalContext,
  maxMemories: number = 10
): Promise<SherpaMemory[]> {
  try {
    const allMemories = await getMemories(userId);
    if (allMemories.length === 0) return [];

    const scored = allMemories.map(m => ({
      memory: m,
      relevance: scoreRelevance(m, ctx),
    }));

    // Corrections ALWAYS get priority
    const corrections = scored
      .filter(s => s.memory.type === 'correction' && s.relevance > 0.1)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 4);

    // Fill remaining slots with highest-relevance non-corrections
    const correctionIds = new Set(corrections.map(c => c.memory.id));
    const rest = scored
      .filter(s => !correctionIds.has(s.memory.id) && s.relevance > 0.2)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, maxMemories - corrections.length);

    const selected = [...corrections, ...rest].map(s => s.memory);

    // Record hits (async, non-blocking)
    for (const m of selected) {
      recordHit(m.id).catch(() => {});
    }

    return selected;
  } catch (e) {
    console.warn('[memory-retriever] Failed to retrieve memories, continuing without:', e);
    return [];
  }
}

/**
 * Format memories into a natural language briefing for system prompt injection.
 * Rich narrative with reasoning context, not just bullet lists.
 */
export function formatMemoriesForPrompt(memories: SherpaMemory[]): string {
  if (memories.length === 0) return '';

  const sections: string[] = [];

  const corrections = memories.filter(m => m.type === 'correction');
  const preferences = memories.filter(m => m.type === 'preference');
  const entities = memories.filter(m => m.type === 'entity');
  const patterns = memories.filter(m => m.type === 'pattern');
  const antiPatterns = memories.filter(m => m.type === 'anti-pattern');

  sections.push('## Sherpa Memory (learned from this user)\n');

  if (corrections.length > 0) {
    sections.push('### CORRECTIONS (always apply — these prevent known mistakes):');
    for (const m of corrections) {
      const conf = Math.round(m.confidence * 100);
      const usage = m.hitCount > 0 ? ` (applied ${m.hitCount} times successfully)` : '';
      const detail = m.reasoning || m.content;
      sections.push(`- [${conf}% confidence${usage}] ${detail}`);
    }
    sections.push('');
  }

  if (preferences.length > 0) {
    sections.push('### PREFERENCES (apply when relevant):');
    for (const m of preferences) {
      sections.push(`- ${m.reasoning || m.content}`);
    }
    sections.push('');
  }

  if (entities.length > 0) {
    sections.push('### DOMAIN KNOWLEDGE:');
    for (const m of entities) {
      sections.push(`- ${m.content}`);
    }
    sections.push('');
  }

  if (patterns.length > 0) {
    sections.push('### WORKFLOW PATTERNS (proactively suggest these):');
    for (const m of patterns) {
      sections.push(`- ${m.content}`);
    }
    sections.push('');
  }

  if (antiPatterns.length > 0) {
    sections.push('### AVOID (user does not want these):');
    for (const m of antiPatterns) {
      sections.push(`- ${m.content}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}
