# Sherpa Memory Architecture — Implementation Specification

## Context for Claude Code

You are implementing a long-term memory system for Sherpa, the AI intelligence layer in Dream State Canvas — an intent-manifestation engine for PE portfolio analysis. Sherpa currently operates statelessly: every session starts from zero. This spec adds persistent learning so Sherpa gets better with each interaction.

**The system already exists and works.** You are adding memory to a functioning workspace, not building from scratch. Read the existing codebase carefully before changing anything. The sacred boundaries documented in CLAUDE.md must be respected.

**Key existing files you'll interact with:**
- `src/hooks/useWorkspaceActions.ts` — action dispatch, intent processing
- `src/lib/intent-engine.ts` — intent parsing (AI + keyword fallback)
- `src/lib/sherpa-engine.ts` — suggestions, observations
- `src/lib/data-analyzer.ts` — DataProfile generation + caching
- `src/lib/data-slicer.ts` — deterministic data operations from DataProfile
- `supabase/functions/ai-chat/index.ts` — AI gateway with mode-based system prompts
- `src/contexts/WorkspaceContext.tsx` — workspace state reducer
- `src/components/workspace/SherpaRail.tsx` — Sherpa UI

---

## Architecture Overview

Memory operates at two tiers:

```
┌─────────────────────────────────────────────────────────┐
│  TIER 1: Prompt Injection (soft influence)               │
│  Memories formatted as natural language, injected into   │
│  the AI system prompt. AI reads and (hopefully) adjusts. │
│  Probabilistic — AI may interpret flexibly.              │
│  Active when: confidence < 0.8                           │
├─────────────────────────────────────────────────────────┤
│  TIER 2: DataProfile Override (hard influence)           │
│  High-confidence memories directly modify DataProfile    │
│  or slicer behavior. Deterministic — AI never sees the   │
│  unsorted/unfiltered data. Code-level enforcement.       │
│  Active when: confidence >= 0.8 OR source = 'confirmed' │
└─────────────────────────────────────────────────────────┘
```

This dual-tier design means the AI can't ignore confirmed user preferences because they're enforced before the AI runs.

---

## Phase 1: Schema + Explicit Memory Creation

### 1.1 Database Schema

Create a new migration:

```sql
create table sherpa_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  type text not null check (type in (
    'correction',    -- user corrected Sherpa's behavior
    'preference',    -- user stated or confirmed a preference
    'entity',        -- domain knowledge (people, companies, relationships)
    'pattern',       -- detected workflow sequence
    'anti-pattern'   -- detected unwanted behavior
  )),
  trigger jsonb not null default '{}',
  content text not null,
  reasoning text,              -- WHY this memory exists (for rich context injection)
  confidence float not null default 0.5,
  source text not null check (source in (
    'explicit',     -- user said "remember that..."
    'inferred',     -- system detected from behavior
    'confirmed'     -- user confirmed an inferred memory
  )) default 'inferred',
  tier text not null check (tier in ('prompt', 'override')) default 'prompt',
  hit_count int not null default 0,
  miss_count int not null default 0,
  last_activated_at timestamptz,
  created_at timestamptz not null default now(),
  tags text[] not null default '{}',
  
  -- Prevent duplicate memories
  constraint unique_memory unique (user_id, type, content)
);

-- Fast retrieval index
create index idx_memories_user_active
  on sherpa_memories(user_id, confidence desc)
  where confidence > 0.3;

-- RPC for batch confidence decay
create or replace function decay_stale_memories(
  target_user_id uuid,
  stale_threshold_days int default 30,
  decay_factor float default 0.9
)
returns void as $$
begin
  update sherpa_memories
  set confidence = confidence * decay_factor
  where user_id = target_user_id
    and source != 'confirmed'
    and last_activated_at < now() - (stale_threshold_days || ' days')::interval
    and confidence > 0.2;
    
  -- Delete memories that have decayed below usefulness
  delete from sherpa_memories
  where user_id = target_user_id
    and confidence < 0.2
    and source != 'confirmed';
    
  -- Delete memories where miss_count exceeds hit_count (self-correcting)
  delete from sherpa_memories
  where user_id = target_user_id
    and miss_count > hit_count
    and hit_count > 2;
end;
$$ language plpgsql;
```

### 1.2 Trigger Schema (TypeScript type)

The trigger field is structured JSON, not free text. This enables deterministic matching without fuzzy keyword search:

```typescript
// src/lib/memory-types.ts

export interface MemoryTrigger {
  onQueryContains?: string[];       // keywords in user input
  onObjectType?: ObjectType[];      // when these object types are involved
  onAction?: WorkspaceActionType[]; // when these actions are about to execute
  onWorkspaceState?: WorkspaceStateCondition;
  always?: boolean;                 // corrections that always apply
}

export type WorkspaceStateCondition = 
  | 'empty'           // no objects on canvas
  | 'post-upload'     // just uploaded a file
  | 'over-capacity'   // breathing system activated
  | 'has-alerts'      // alert objects present
  | 'has-dataset'     // dataset object present
  | 'immersive'       // user is in immersive mode
  | 'fusing';         // fusion in progress

export type MemoryType = 'correction' | 'preference' | 'entity' | 'pattern' | 'anti-pattern';
export type MemorySource = 'explicit' | 'inferred' | 'confirmed';
export type MemoryTier = 'prompt' | 'override';

export interface SherpaMemory {
  id: string;
  userId: string;
  type: MemoryType;
  trigger: MemoryTrigger;
  content: string;
  reasoning?: string;        // rich context for injection
  confidence: number;
  source: MemorySource;
  tier: MemoryTier;
  hitCount: number;
  missCount: number;
  lastActivatedAt: string | null;
  createdAt: string;
  tags: string[];
}
```

### 1.3 Explicit Memory Creation

Detect "remember that..." patterns in the intent engine. Add to the keyword fallback patterns in `intent-engine.ts`:

```typescript
// Add to patterns array in intent-engine.ts
{
  keywords: ['remember', 'always', 'never', 'don\'t forget', 'keep in mind'],
  generate: async (input, existing) => {
    // Extract the memory content from the user's statement
    const content = input
      .replace(/^(remember|always|never|don't forget|keep in mind)\s*(that\s*)?/i, '')
      .trim();
    
    if (!content) {
      return [{ type: 'respond', message: 'What should I remember?' }];
    }

    const isCorrection = /never|don't|stop|not/i.test(input);
    const memoryType: MemoryType = isCorrection ? 'correction' : 'preference';
    
    // Determine trigger structure
    const trigger: MemoryTrigger = {};
    if (/always|every time|whenever/i.test(input)) {
      trigger.always = true;
    }
    // Extract keywords for contextual triggering
    const keywords = content.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3 && !['that','this','when','with','from','should'].includes(w));
    if (keywords.length > 0 && !trigger.always) {
      trigger.onQueryContains = keywords.slice(0, 5);
    }

    await createMemory({
      type: memoryType,
      trigger,
      content,
      reasoning: `User explicitly stated: "${input}"`,
      confidence: 0.9,  // explicit memories start high
      source: 'explicit',
      tags: keywords,
    });

    return [{
      type: 'respond',
      message: `Noted. I'll ${isCorrection ? 'avoid' : 'remember'}: ${content}`,
    }];
  },
},
```

Also handle this in the AI intent parser. Add to the system prompt in `ai-chat/index.ts` for the `intent` mode:

```
- Use "remember" action when user says "remember that...", "always...", "never..."
  { "type": "remember", "memoryType": "correction|preference|entity", "content": "what to remember", "reasoning": "why" }
```

And handle the `remember` action in `useWorkspaceActions.ts`.

### 1.4 Memory CRUD Module

Create `src/lib/memory-store.ts`:

```typescript
import { supabase } from '@/integrations/supabase/client';
import { SherpaMemory, MemoryTrigger, MemoryType, MemorySource } from './memory-types';

export async function createMemory(params: {
  type: MemoryType;
  trigger: MemoryTrigger;
  content: string;
  reasoning?: string;
  confidence?: number;
  source?: MemorySource;
  tags?: string[];
}): Promise<SherpaMemory | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('sherpa_memories')
    .upsert({
      user_id: user.id,
      type: params.type,
      trigger: params.trigger,
      content: params.content,
      reasoning: params.reasoning || null,
      confidence: params.confidence ?? 0.5,
      source: params.source ?? 'inferred',
      tier: (params.confidence ?? 0.5) >= 0.8 ? 'override' : 'prompt',
      tags: params.tags ?? [],
    }, {
      onConflict: 'user_id, type, content',
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create memory:', error);
    return null;
  }
  return data as unknown as SherpaMemory;
}

export async function getMemories(userId: string): Promise<SherpaMemory[]> {
  const { data, error } = await supabase
    .from('sherpa_memories')
    .select('*')
    .eq('user_id', userId)
    .gt('confidence', 0.3)
    .order('confidence', { ascending: false });

  if (error) return [];
  return (data || []) as unknown as SherpaMemory[];
}

export async function confirmMemory(id: string): Promise<void> {
  await supabase
    .from('sherpa_memories')
    .update({ source: 'confirmed', confidence: 1.0, tier: 'override' })
    .eq('id', id);
}

export async function deleteMemory(id: string): Promise<void> {
  await supabase
    .from('sherpa_memories')
    .delete()
    .eq('id', id);
}

export async function recordHit(id: string): Promise<void> {
  await supabase.rpc('increment_memory_hit', { memory_id: id });
  // Create this RPC:
  // update sherpa_memories set hit_count = hit_count + 1, 
  //   last_activated_at = now(),
  //   confidence = least(1.0, confidence + 0.05)
  // where id = memory_id;
}

export async function recordMiss(id: string): Promise<void> {
  await supabase.rpc('increment_memory_miss', { memory_id: id });
  // update sherpa_memories set miss_count = miss_count + 1,
  //   confidence = greatest(0.1, confidence - 0.1)
  // where id = memory_id;
}
```

---

## Phase 2: Retrieval + Prompt Injection (Tier 1)

### 2.1 Relevance Scoring and Retrieval

Create `src/lib/memory-retriever.ts`:

```typescript
import { SherpaMemory, MemoryTrigger } from './memory-types';
import { WorkspaceObject, WorkspaceActionType, ObjectType } from './workspace-types';
import { getMemories, recordHit } from './memory-store';

interface RetrievalContext {
  query: string;
  objectTypes: ObjectType[];          // types currently on canvas
  pendingAction?: WorkspaceActionType; // action about to execute
  workspaceState: string;             // empty, post-upload, etc.
}

/**
 * Score how relevant a memory is to the current context.
 * Returns 0-1. Higher = more relevant.
 */
function scoreRelevance(memory: SherpaMemory, ctx: RetrievalContext): number {
  const trigger = memory.trigger as MemoryTrigger;
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
 * Retrieve the most relevant memories for the current interaction.
 * 
 * Budget: 8-12 memories max, corrections always included.
 * Total injection target: 1500-2500 tokens.
 */
export async function retrieveRelevantMemories(
  userId: string,
  ctx: RetrievalContext,
  maxMemories: number = 10
): Promise<SherpaMemory[]> {
  const allMemories = await getMemories(userId);
  if (allMemories.length === 0) return [];

  // Score all memories
  const scored = allMemories.map(m => ({
    memory: m,
    relevance: scoreRelevance(m, ctx),
  }));

  // Corrections ALWAYS get priority (they're "don't touch the stove" memories)
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
}

/**
 * Format memories into a natural language briefing for system prompt injection.
 * 
 * IMPORTANT: This is NOT a bullet list. It's a rich narrative that gives the AI
 * enough context to understand WHY each memory exists and how to apply it in
 * edge cases. Budget: 1500-2500 tokens.
 */
export function formatMemoriesForPrompt(memories: SherpaMemory[]): string {
  if (memories.length === 0) return '';

  const sections: string[] = [];

  // Group by type
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
      // Use reasoning field for rich context, fall back to content
      const detail = m.reasoning || m.content;
      sections.push(`- [${conf}% confidence${usage}] ${detail}`);
    }
    sections.push('');
  }

  if (preferences.length > 0) {
    sections.push('### PREFERENCES (apply when relevant):');
    for (const m of preferences) {
      const detail = m.reasoning || m.content;
      sections.push(`- ${detail}`);
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
```

### 2.2 Integration into AI Gateway

Modify `supabase/functions/ai-chat/index.ts` to accept and inject memories:

```typescript
// In the request body parsing:
const { messages, mode, memories } = await req.json();

// Build the system prompt with memories injected
let systemPrompt = systemPrompts[mode] || systemPrompts.intent;

if (memories && typeof memories === 'string' && memories.length > 0) {
  // Insert memories AFTER the base system prompt but BEFORE any mode-specific rules
  systemPrompt = systemPrompt + '\n\n' + memories;
}
```

### 2.3 Integration into Intent Processing

Modify `useWorkspaceActions.ts` to retrieve and inject memories before AI calls:

```typescript
// At the top of processIntent, before calling parseIntentAI:
const user = await supabase.auth.getUser();
const userId = user.data?.user?.id;

let memoryBlock = '';
if (userId) {
  const ctx: RetrievalContext = {
    query,
    objectTypes: Object.values(state.objects)
      .filter(o => o.status !== 'dissolved')
      .map(o => o.type),
    workspaceState: determineWorkspaceState(state),
  };
  const memories = await retrieveRelevantMemories(userId, ctx);
  memoryBlock = formatMemoriesForPrompt(memories);
}

// Pass memoryBlock to parseIntentAI, which passes it to callAI
const result = await parseIntentAI(query, state.objects, _documentIdsRef, memoryBlock);
```

Update `callAI` to accept and forward the memory block:

```typescript
export async function callAI(
  messages: Message[],
  mode: string = 'intent',
  documentIds?: string[],
  memories?: string           // <-- new parameter
): Promise<string | null> {
  // ... existing code ...
  const body: Record<string, unknown> = { messages, mode };
  if (documentIds?.length) body.documentIds = documentIds;
  if (memories) body.memories = memories;  // <-- pass to edge function
  // ... rest of existing code ...
}
```

---

## Phase 3: Implicit Detection (Learning Signals)

### 3.1 Detection Module

Create `src/lib/memory-detector.ts`:

```typescript
import { WorkspaceAction, WorkspaceObject } from './workspace-types';
import { createMemory } from './memory-store';
import { MemoryTrigger } from './memory-types';

interface ActionRecord {
  action: WorkspaceAction;
  query: string;
  timestamp: number;
  objectsCreated?: string[];  // IDs of objects created by this action
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
 * Call this AFTER each intent is processed.
 */
export async function detectLearningSignals(
  currentQuery: string,
  currentAction: WorkspaceAction,
  objects: Record<string, WorkspaceObject>
): Promise<void> {
  const now = Date.now();
  const previousRecord = recentActions[recentActions.length - 2]; // -1 is current
  if (!previousRecord) return;

  const timeSinceLast = now - previousRecord.timestamp;

  // ──────────────────────────────────────────────────────
  // Signal 1: Rapid Dissolution (anti-pattern)
  // User creates something and dissolves it within 15 seconds
  // ──────────────────────────────────────────────────────
  if (
    currentAction.type === 'dissolve' &&
    previousRecord.action.type === 'create' &&
    timeSinceLast < 15000
  ) {
    const prevCreate = previousRecord.action;
    const existing = await findSimilarMemory(
      'anti-pattern',
      `dissolved ${prevCreate.objectType}`
    );

    if (existing) {
      // Pattern already detected — bump confidence
      // (handled by upsert + increment in createMemory)
    }

    await createMemory({
      type: 'anti-pattern',
      trigger: {
        onQueryContains: previousRecord.query.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 4),
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

  // ──────────────────────────────────────────────────────
  // Signal 2: Correction Language (correction)
  // User says "no", "not", "stop", "wrong", "I meant", etc.
  // ──────────────────────────────────────────────────────
  if (/\b(no|not|stop|wrong|don't|didn't mean|i meant|i said|that's not)\b/i.test(currentQuery)) {
    const prevQuery = previousRecord.query;
    const prevAction = previousRecord.action;

    await createMemory({
      type: 'correction',
      trigger: {
        onQueryContains: prevQuery.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 4),
      },
      content: `When user said "${prevQuery}", Sherpa responded with "${prevAction.type}" but user corrected with "${currentQuery}". The original response was wrong.`,
      reasoning: `User explicitly corrected Sherpa's interpretation. Previous query: "${prevQuery}" → Action: ${prevAction.type}. Correction: "${currentQuery}". Sherpa should handle similar future queries differently.`,
      confidence: 0.7,  // corrections start higher
      source: 'inferred',
      tags: ['auto-detected', 'correction', prevAction.type],
    });
  }

  // ──────────────────────────────────────────────────────
  // Signal 3: Workflow Sequence (pattern)
  // Detect repeated A → B sequences
  // ──────────────────────────────────────────────────────
  if (recentActions.length >= 4) {
    detectWorkflowPatterns();
  }
}

/**
 * Scan action history for repeated sequences.
 * If action type A is followed by action type B three or more times,
 * propose it as a workflow pattern.
 */
async function detectWorkflowPatterns(): Promise<void> {
  const createActions = recentActions
    .filter(r => r.action.type === 'create')
    .map(r => ({
      objectType: (r.action as any).objectType,
      timestamp: r.timestamp,
    }));

  // Look for pairs
  const pairCounts = new Map<string, number>();
  for (let i = 0; i < createActions.length - 1; i++) {
    const pair = `${createActions[i].objectType}→${createActions[i + 1].objectType}`;
    const timeBetween = createActions[i + 1].timestamp - createActions[i].timestamp;
    if (timeBetween < 60000) { // within 1 minute
      pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
    }
  }

  for (const [pair, count] of pairCounts) {
    if (count >= 3) {
      const [typeA, typeB] = pair.split('→');
      await createMemory({
        type: 'pattern',
        trigger: {
          onObjectType: [typeA as any],
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

// Helper to check if a similar memory already exists
async function findSimilarMemory(type: string, contentFragment: string): Promise<boolean> {
  const { data } = await supabase
    .from('sherpa_memories')
    .select('id')
    .eq('type', type)
    .ilike('content', `%${contentFragment}%`)
    .limit(1);
  return (data?.length ?? 0) > 0;
}
```

### 3.2 Wire Detection into Action Processing

In `useWorkspaceActions.ts`, after each action is applied:

```typescript
import { recordAction, detectLearningSignals } from '@/lib/memory-detector';

// Inside applyResult, after each action case:
recordAction({
  action,
  query: origin.query || '',
  timestamp: Date.now(),
});

// At the end of applyResult:
if (result.actions.length > 0) {
  const lastAction = result.actions[result.actions.length - 1];
  detectLearningSignals(origin.query || '', lastAction, state.objects)
    .catch(() => {}); // non-blocking
}
```

---

## Phase 4: User Visibility Panel

### 4.1 Memory Panel Component

Create `src/components/workspace/MemoryPanel.tsx`:

This should display in the SherpaRail admin section (alongside the existing rules editor and admin controls). Design:

```
┌─────────────────────────────────────────┐
│  SHERPA MEMORY                    clear  │
│  12 memories · 3 pending confirmation    │
│                                          │
│  PENDING CONFIRMATION (confirm or delete)│
│  ┌────────────────────────────────────┐  │
│  │ ? You seem to prefer fuse over    │  │
│  │   compare for side-by-side work   │  │
│  │              [Confirm] [Dismiss]   │  │
│  └────────────────────────────────────┘  │
│                                          │
│  CORRECTIONS (3)                         │
│  ✓ "compare" → fuse       94% · 8× [×]  │
│  ✓ Never sort $ > tiers   91% · 14× [×] │
│  ✓ No inspector for       72% · 3×  [×] │
│    "overview"                            │
│                                          │
│  PREFERENCES (4)                         │
│  ◆ Post-upload: brief     88% · 6×  [×] │
│  ◆ Collapsed tables       65% · 4×  [×] │
│  ...                                     │
│                                          │
│  PATTERNS (2)                            │
│  ○ upload → brief → fuse  55% · 3×  [×] │
│  ...                                     │
└─────────────────────────────────────────┘
```

- Confidence shown as percentage
- Hit count shown as ×N
- Delete button on each memory
- Pending inferred memories get Confirm/Dismiss buttons
- Confirming promotes to source='confirmed', confidence=1.0, tier='override'
- Dismissing deletes the memory

### 4.2 Surface Pending Memories in NOTICED Section

Inferred memories with confidence between 0.5-0.7 should appear in the Sherpa's NOTICED observations:

In `sherpa-engine.ts`, add to `generateObservations`:

```typescript
// Pull pending (inferred, unconfirmed) memories
const pendingMemories = await getPendingMemories(userId);
for (const m of pendingMemories.slice(0, 2)) {
  observations.push(`I think I've learned: ${m.content} — is that right?`);
  // The AmbientHint component's accept/dismiss will call confirmMemory/deleteMemory
}
```

---

## Phase 5: Confidence Scoring + Decay

### 5.1 Confidence Lifecycle

```
Event                          | Effect
-------------------------------|----------------------------------
Memory created (explicit)      | confidence = 0.9
Memory created (inferred)      | confidence = 0.5
Memory activated, no correction| confidence += 0.05 (cap 0.95)
Same pattern detected again    | confidence += 0.15
User confirms via NOTICED      | confidence = 1.0, source = 'confirmed'
User dismisses via NOTICED     | DELETE memory
User corrects despite memory   | missCount++, confidence -= 0.1
30 days without activation     | confidence *= 0.9
confidence < 0.2               | DELETE memory
missCount > hitCount (after 2+)| DELETE memory (self-correcting)
```

### 5.2 Tier Promotion

When confidence crosses 0.8 OR source becomes 'confirmed':
```typescript
// In createMemory or recordHit, after updating confidence:
if (memory.confidence >= 0.8 || memory.source === 'confirmed') {
  memory.tier = 'override';
}
```

### 5.3 Decay on Login

Run decay check when user authenticates or on first interaction of the day:

```typescript
// In useAuth or WorkspaceShell mount:
const lastDecay = localStorage.getItem('sherpa-last-decay');
const today = new Date().toDateString();
if (lastDecay !== today) {
  supabase.rpc('decay_stale_memories', { target_user_id: userId });
  localStorage.setItem('sherpa-last-decay', today);
}
```

---

## Phase 6: DataProfile Overrides (Tier 2)

This is the architectural payoff. Tier 2 memories modify the DataProfile BEFORE the AI runs.

### 6.1 Apply Memory Overrides to DataProfile

In `data-analyzer.ts`, after generating or loading a profile:

```typescript
import { getOverrideMemories } from './memory-store';

export async function analyzeDataset(
  columns: string[],
  rows: string[][]
): Promise<DataProfile> {
  // ... existing profile generation logic ...
  
  let profile = cached || await generateProfile(columns, rows);
  
  // Apply Tier 2 memory overrides
  const overrides = await getOverrideMemories(userId);
  profile = applyMemoryOverrides(profile, overrides);
  
  return profile;
}

function applyMemoryOverrides(
  profile: DataProfile,
  memories: SherpaMemory[]
): DataProfile {
  const result = { ...profile };

  for (const m of memories) {
    // Sorting overrides
    if (m.tags.includes('sorting') && m.confidence >= 0.8) {
      if (/tier|priority|rank/i.test(m.content) && result.ordinalPriorityColumn) {
        // Reinforce: never override ordinal priority with numeric sorting
        // This is a hard lock that the AI can't bypass
        result.previewStrategy = `LOCKED by user preference: ${result.previewStrategy}`;
      }
    }

    // Display column preferences
    if (m.tags.includes('columns') && m.type === 'preference') {
      // User prefers certain columns visible/hidden
      // Parse from content and adjust displayColumns
    }

    // Default object preferences
    if (m.tags.includes('default-collapsed') && m.type === 'preference') {
      // Could be used to influence object creation defaults
    }
  }

  return result;
}
```

### 6.2 getOverrideMemories Helper

In `memory-store.ts`:

```typescript
export async function getOverrideMemories(userId: string): Promise<SherpaMemory[]> {
  const { data } = await supabase
    .from('sherpa_memories')
    .select('*')
    .eq('user_id', userId)
    .eq('tier', 'override')
    .gte('confidence', 0.8)
    .order('confidence', { ascending: false });

  return (data || []) as unknown as SherpaMemory[];
}

export async function getPendingMemories(userId: string): Promise<SherpaMemory[]> {
  const { data } = await supabase
    .from('sherpa_memories')
    .select('*')
    .eq('user_id', userId)
    .eq('source', 'inferred')
    .gte('confidence', 0.5)
    .lte('confidence', 0.75)
    .order('created_at', { ascending: false })
    .limit(5);

  return (data || []) as unknown as SherpaMemory[];
}
```

---

## Implementation Order

| Phase | What | Effort | Dependencies |
|-------|------|--------|-------------|
| 1 | Schema + explicit creation | 1 day | Supabase migration |
| 2 | Retrieval + prompt injection | 1 day | Phase 1 |
| 3 | Implicit signal detection | 1 day | Phase 1 |
| 4 | User visibility panel | 0.5 day | Phase 1 |
| 5 | Confidence lifecycle + decay | 0.5 day | Phase 1 |
| 6 | DataProfile overrides (Tier 2) | 1 day | Phase 2 + 5 |

Phases 1-2 make the system functional. Phase 3 makes it learn. Phase 4 makes it trustworthy. Phase 5 keeps it clean. Phase 6 makes it mechanical.

---

## Critical Rules (Do Not Violate)

1. **Corrections are sacred.** They always get injected, always get priority, never decay below 0.3 unless the user explicitly deletes them.

2. **Inferred memories require confirmation before reaching Tier 2.** No inferred memory should modify the DataProfile unless it's been explicitly confirmed by the user OR has survived 6+ activations without correction (hitCount >= 6, missCount = 0).

3. **The user can always see and delete their memories.** No black box. Every memory has a delete button.

4. **Memory retrieval is non-blocking.** If Supabase is slow or down, Sherpa works without memories. The intent engine's keyword fallback already handles AI-less operation; memory retrieval should degrade the same way.

5. **Memory injection budget: 1500-2500 tokens.** Not a hard cap, but a design target. Include the reasoning/context for each memory, not just the content. The AI needs to understand WHY a correction exists to handle edge cases. A single rich correction is worth more than 10 terse bullets.

6. **Protect the data-analyzer/slicer boundary.** Memory overrides (Phase 6) modify the DataProfile BEFORE it reaches the slicer. They do NOT modify slicer logic directly. The slicer remains a pure function of its inputs.

7. **Don't inject memory context into fusion calls.** Fusion prompts are already context-heavy with two objects' worth of data. Memory injection goes into intent parsing, schema analysis, and brief generation — not fusion. Fusion quality depends on maximizing source object context, not user preference context.
