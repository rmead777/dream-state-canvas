# Solar Insight Patterns — Implementation Specification

## Context

Borrowing battle-tested patterns from Solar Insight (a production PE portfolio analytics app) to upgrade Dream State Canvas's AI intelligence, UI responsiveness, and design system maturity.

**Source codebase:** `C:\Users\Ryan\02_APP_DEVELOPMENT\Production\Solar_Insight\solar-insight`
**Target codebase:** `c:\Users\Ryan\dream-state-canvas`

These are architectural transplants, not feature copies. Each pattern is adapted to Dream State Canvas's intent-manifestation paradigm.

---

## Phase 1: Streaming Performance + AI Context (Immediate Impact)

### 1.1 — 80ms Batched Streaming Flush

**Problem:** Sherpa re-renders on every SSE token during streaming. On long AI responses this causes visible jank.

**Pattern from Solar:** Accumulate tokens in a ref, flush to state every 80ms.

**Files to change:**
- `src/hooks/useAI.ts` — both `streamChat` and the streaming section of `callAI`

**Implementation:**
```typescript
// In useAI's streamChat:
const streamingRef = useRef('');
const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// In the SSE token loop:
streamingRef.current += content;
if (!flushTimerRef.current) {
  flushTimerRef.current = setTimeout(() => {
    onDelta?.(streamingRef.current); // flush accumulated
    flushTimerRef.current = null;
  }, 80);
}

// On stream end: final flush
if (flushTimerRef.current) {
  clearTimeout(flushTimerRef.current);
  flushTimerRef.current = null;
}
onDelta?.(streamingRef.current); // ensure last chunk arrives
```

**Effort:** 30 minutes. Zero risk — purely additive performance improvement.

### 1.2 — useAIContext: Automatic Context Injection

**Problem:** The AI context is built ad-hoc in `buildIntentPayloadContext` by manually reading workspace state. It misses UI state like which tab is active, what the user last interacted with, and document scope.

**Pattern from Solar:** A dedicated `useAIContext()` hook that reads from React context + React Query cache to produce a typed `AppContext` object injected into every AI call.

**Files to create:**
- `src/hooks/useAIContext.ts`

**Files to change:**
- `src/lib/intent-engine.ts` — replace `buildIntentPayloadContext` with the hook's output
- `src/hooks/useWorkspaceActions.ts` — consume `useAIContext` and pass to `parseIntentAI`

**Implementation:**
```typescript
// src/hooks/useAIContext.ts
export interface WorkspaceAIContext {
  // What the user is looking at RIGHT NOW
  focusedCard: {
    id: string;
    type: string;
    title: string;
    rowCount: number | null;
    currentFilters: Record<string, any>;
    currentLimit: number | null;
  } | null;

  // Workspace state
  activeCardCount: number;
  activeCardTypes: string[];
  cardSummaries: Array<{
    id: string;
    type: string;
    title: string;
    isFocused: boolean;
    rowCount?: number;
  }>;

  // Data context
  datasetLoaded: boolean;
  datasetName: string | null;
  datasetRowCount: number;
  datasetColumns: string[];

  // Document context
  documentCount: number;
  activeDocumentScope: 'auto' | 'manual';

  // User context
  userEmail: string | null;

  // Session context
  conversationTurnCount: number;
  lastActionType: string | null;
}
```

The hook computes this from `useWorkspace()`, `useDocuments()`, `useAuth()`, and `getActiveDataset()` — no extra queries.

This object gets JSON-serialized and injected into the AI system prompt as `Workspace Context:` before the user's query. It replaces the current `buildWorkspaceIntentContext` which is a separate function in workspace-intelligence.ts.

**Why this matters:** The AI always knows: what card is focused, how many rows it shows, what filters are applied, what documents are loaded, what the user's recent activity was. No guessing.

**Effort:** 2 hours. Medium risk — changes the context pipeline.

---

## Phase 2: Resizable Sherpa Panel (UI Upgrade)

### 2.1 — Drag-to-Resize Sherpa Rail

**Problem:** SherpaRail is fixed-width (~380px). On wide screens there's wasted space. On narrow screens it's too wide. Users can't give Sherpa more room when reviewing complex analysis cards.

**Pattern from Solar:** `onMouseDown` on a drag handle → global `mousemove`/`mouseup` listeners → clamp width between min/max → persist to localStorage.

**Files to change:**
- `src/components/workspace/SherpaRail.tsx` — add resize handle + width state
- `src/components/workspace/WorkspaceShell.tsx` — pass dynamic width to layout

**Implementation:**
```typescript
const MIN_WIDTH = 320;
const MAX_WIDTH = 800;
const STORAGE_KEY = 'sherpa-rail-width';

const [width, setWidth] = useState(() => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parseInt(stored))) : 380;
});

const handleMouseDown = useCallback((e: React.MouseEvent) => {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = width;

  const onMouseMove = (e: MouseEvent) => {
    // Drag LEFT to make wider (rail is on the right)
    const delta = startX - e.clientX;
    const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
    setWidth(newWidth);
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    localStorage.setItem(STORAGE_KEY, String(width));
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}, [width]);
```

The drag handle is a 4px vertical strip on the left edge of SherpaRail with a subtle cursor change (`cursor-col-resize`).

**Effort:** 1 hour. Low risk.

---

## Phase 3: Design Token Architecture (Design System)

### 3.1 — TypeScript Design Token Module

**Problem:** Colors are scattered across Tailwind classes, CSS variables, and inline styles. No single source of truth. Status colors (urgency) and identity colors (object types) aren't consistently separated.

**Pattern from Solar:** A `design-tokens.ts` file that exports every color/shadow/font as typed constants, organized by semantic category.

**Files to create:**
- `src/lib/design-tokens.ts`

**Files to change:**
- Gradually migrate components from hardcoded Tailwind classes to token references

**Token categories for Dream State Canvas:**
```typescript
export const tokens = {
  // Object type identity (NEVER for status)
  objectTypes: {
    metric: { bg: '...', text: '...', border: '...', icon: '📊' },
    alert: { bg: '...', text: '...', border: '...', icon: '⚠' },
    analysis: { bg: '...', text: '...', border: '...', icon: '✦' },
    'action-queue': { bg: '...', text: '...', border: '...', icon: '☐' },
    // ... all 15 types
  },

  // Status/severity (NEVER for identity)
  status: {
    critical: { bg: '...', text: '...', border: '...' },
    warning: { bg: '...', text: '...', border: '...' },
    info: { bg: '...', text: '...', border: '...' },
    success: { bg: '...', text: '...', border: '...' },
  },

  // Tier urgency (maps to DataProfile tiers)
  tiers: {
    'tier-1': { bg: '...', text: '...', label: 'Act Now' },
    'tier-2': { bg: '...', text: '...', label: 'Unblock' },
    'tier-3': { bg: '...', text: '...', label: 'Monitor' },
  },

  // Surface/elevation
  surface: {
    page: '#f8f7f4',     // warm off-white (from Solar)
    card: '#ffffff',
    elevated: '#ffffff',
    shadow: { sm: '...', md: '...', lg: '...' },
  },

  // Brand accent
  accent: {
    primary: 'hsl(var(--workspace-accent))',
    light: '...',
    bg: '...',
  },

  // Spring easings
  easing: {
    bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
};
```

**Effort:** 2 hours for the module. Migration is ongoing — components adopt tokens incrementally.

### 3.2 — Spring Easing Tokens in Tailwind

**Files to change:**
- `tailwind.config.ts` — add named easings

```typescript
transitionTimingFunction: {
  'spring-bounce': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  'spring-smooth': 'cubic-bezier(0.22, 1, 0.36, 1)',
},
```

**Effort:** 10 minutes.

---

## Phase 4: AI Agent Architecture Upgrade (Highest Impact, Most Work)

### 4.1 — Tool-Using Agent Loop

**Problem:** Sherpa is a single-turn intent parser. One prompt → one JSON response → done. It can't call tools, verify results, or iterate. When it needs data to answer a question, it guesses instead of looking it up.

**Pattern from Solar:** Multi-iteration agent loop with tool calling. The AI can:
1. Receive user query
2. Call tools (read data, search, compute)
3. Get tool results
4. Decide: need more tools? or ready to respond?
5. Loop up to N iterations
6. Final response

**This is the gap between "intent parser" and "intelligent agent."**

**Files to create:**
- `src/lib/sherpa-agent.ts` — agent loop with tool dispatch
- `src/lib/sherpa-tools.ts` — tool definitions + executors

**Files to change:**
- `supabase/functions/ai-chat/index.ts` — support tool_calls in response format
- `src/hooks/useWorkspaceActions.ts` — use agent loop instead of single parseIntentAI call

**Tool definitions for Sherpa:**
```typescript
const SHERPA_TOOLS = [
  // READ tools — access workspace data
  {
    name: 'getCardData',
    description: 'Get the full data (rows, columns, filters) of a specific card',
    parameters: { objectId: 'string' },
  },
  {
    name: 'queryDataset',
    description: 'Run a filter/sort/limit query against the active dataset',
    parameters: { filter: 'object', sort: 'object', limit: 'number', columns: 'string[]' },
  },
  {
    name: 'getWorkspaceState',
    description: 'Get all cards on the canvas with their types, titles, and summaries',
    parameters: {},
  },
  {
    name: 'getDocumentContent',
    description: 'Get the extracted text/data from an uploaded document',
    parameters: { documentId: 'string' },
  },
  {
    name: 'searchData',
    description: 'Search across all rows for a text match',
    parameters: { query: 'string', column: 'string?' },
  },

  // WRITE tools — modify workspace
  {
    name: 'updateCard',
    description: 'Change a card\'s data query, sections, or title',
    parameters: { objectId: 'string', dataQuery: 'object?', sections: 'array?', title: 'string?' },
  },
  {
    name: 'createCard',
    description: 'Create a new card on the canvas',
    parameters: { objectType: 'string', title: 'string', dataQuery: 'object?', sections: 'array?' },
  },
  {
    name: 'dissolveCard',
    description: 'Remove a card from the canvas',
    parameters: { objectId: 'string' },
  },
  {
    name: 'focusCard',
    description: 'Bring a card to the user\'s attention',
    parameters: { objectId: 'string' },
  },

  // MEMORY tools
  {
    name: 'rememberFact',
    description: 'Store a fact, preference, or correction in long-term memory',
    parameters: { type: 'string', content: 'string', reasoning: 'string' },
  },
  {
    name: 'recallMemories',
    description: 'Search memories relevant to the current context',
    parameters: { query: 'string' },
  },
];
```

**Agent loop pseudocode:**
```
function sherpaAgentLoop(userQuery, context, maxIterations = 5):
  messages = [systemPrompt, ...conversationHistory, userMessage]

  for i in range(maxIterations):
    response = await callAI(messages, tools=SHERPA_TOOLS)

    if response.has_tool_calls:
      for each tool_call:
        result = await executeTool(tool_call)
        messages.push({ role: 'tool', content: result })
      continue  // let AI process tool results

    else:
      // AI is done — return final response + actions
      return parseActions(response)

  // Max iterations reached — return what we have
  return { response: "I've gathered what I can. Here's what I found:", actions: [...] }
```

**Why this changes everything:**
- "Why does the comparison card show White Oak?" → AI calls `getCardData(cardId)`, sees the actual data, gives a real answer
- "Show me vendors with payment plans" → AI calls `searchData("payment plan")`, finds the actual vendors, creates a card with real results
- "Update that card to 5 rows" → AI calls `updateCard(id, { dataQuery: { limit: 5 } })` directly — no interpretation chain

**Effort:** 2-3 days. High impact, medium risk. The agent loop is the single most transformative change possible.

**NOTE:** This requires the edge function to support tool_calls in its response format. If using the Lovable gateway, check if it supports function calling / tool_use. If not, this needs a direct provider API (Anthropic or OpenAI) which requires the API keys we've been trying to get set up.

### 4.2 — Memory Supersession Chains

**Problem:** Sherpa's memory entries are independent. When a new memory contradicts an old one, both exist. There's no "this replaced that" tracking.

**Pattern from Solar:** Each memory entry has a `superseded_by` field. When a new memory replaces an old one, the old entry points to the new one. The retriever follows chains to always get the latest version.

**Files to change:**
- `supabase/migrations/` — new migration adding `superseded_by uuid REFERENCES sherpa_memories(id)` + `is_active boolean DEFAULT true`
- `src/lib/memory-store.ts` — update create to supersede matching entries
- `src/lib/memory-retriever.ts` — filter to `is_active = true`

**Effort:** 1 hour. Low risk.

**⚠️ DEPLOYMENT NEEDED:** New migration + edge function if memory queries change.

### 4.3 — Living Narrative Documents

**Problem:** Sherpa creates briefs that are point-in-time snapshots. There's no "evolving brief" that gets amended as new data arrives.

**Pattern from Solar:** Narrative entries per entity (vendor, theme, portfolio) that accumulate amendments with source tracking.

**Files to create:**
- `src/lib/narrative-store.ts`
- Migration for `sherpa_narratives` table

**Schema:**
```typescript
interface SherpaNarrative {
  id: string;
  userId: string;
  entityType: 'vendor' | 'theme' | 'workspace' | 'custom';
  entityName: string;
  content: string;           // current narrative (markdown)
  amendments: Amendment[];   // history of changes
  lastAmendedAt: string;
  isStale: boolean;          // true if data has changed since last amendment
}

interface Amendment {
  date: string;
  source: string;            // "user query", "document upload", "auto-observation"
  change: string;            // what was added/modified
  previousExcerpt: string;   // what it replaced
}
```

**Effort:** 2 hours. Low risk.

**⚠️ DEPLOYMENT NEEDED:** New migration.

---

## Phase 5: Intelligence Feed + Health Indicators (UI Polish)

### 5.1 — Intelligence Feed (Event Cards)

**Problem:** Sherpa's observations are plain text strings in the NOTICED section. No severity, no filtering, no pinning.

**Pattern from Solar:** Convert AI observations into structured event cards with severity, confidence, scope, evidence chips, and suggested follow-up prompts.

**Files to create:**
- `src/components/workspace/IntelligenceFeed.tsx`

**Files to change:**
- `src/lib/sherpa-engine.ts` — generate structured observations instead of strings
- `src/components/workspace/SherpaRail.tsx` — replace NOTICED section with IntelligenceFeed

**Effort:** 3 hours. Low risk.

### 5.2 — Workspace Health Radar

**Problem:** No at-a-glance indicator of workspace quality — are the cards stale? is the data fresh? has Sherpa learned from corrections?

**Pattern from Solar:** PortfolioRadar — 3-4 horizontal bars showing health metrics, each 0-100%, with localStorage trend comparison showing deltas.

**Metrics for Dream State Canvas:**
- **Data freshness:** how recently was the dataset uploaded/updated?
- **Coverage:** what % of urgent vendors have been looked at (cards created)?
- **Memory health:** how many memories, how many confirmed vs inferred?
- **Action progress:** what % of action-queue items are completed?

**Files to create:**
- `src/components/workspace/WorkspaceRadar.tsx`

**Effort:** 2 hours. Low risk.

### 5.3 — Seamless Activity Ticker

**Problem:** No ambient awareness of what's happening — uploads, card creation, observations — without looking at the Sherpa rail.

**Pattern from Solar:** Horizontal scrolling ticker using duplicated-array trick with CSS `translateX(0%) → translateX(-50%)`, gradient fade edges.

**Files to create:**
- `src/components/workspace/ActivityTicker.tsx`

**Where it lives:** Inside the WorkspaceBar (bottom bar) between collapsed objects and utility buttons.

**Effort:** 1 hour. Low risk.

---

## Phase 6: CommandPalette Upgrade

### 6.1 — Canned Prompt Categories

**Problem:** ⌘K command palette is basic — just object search and a few actions.

**Pattern from Solar:** CommandPalette with categorized canned prompts: Analysis, Data, Reporting. Each prompt is pre-written and fires via processIntent.

**Add to Dream State Canvas:**
```typescript
const CANNED_PROMPTS = {
  'Quick Actions': [
    { label: 'What should I do today?', query: 'Show my action queue for today' },
    { label: 'Who needs a call?', query: 'Create a vendor dossier for the most urgent vendor' },
    { label: 'How should I spend $50K?', query: 'Create a cash allocation plan for $50,000' },
  ],
  'Analysis': [
    { label: 'What\'s getting worse?', query: 'Show escalation tracker' },
    { label: 'Production risk map', query: 'Map production risks' },
    { label: 'Communication gaps', query: 'Show outreach tracker' },
  ],
  'Workspace': [
    { label: 'Collapse all cards', action: 'collapse-all' },
    { label: 'Clear canvas', action: 'clear-canvas' },
    { label: 'Show full dataset', query: 'Show the full dataset' },
  ],
};
```

**Files to change:**
- `src/components/workspace/CommandPalette.tsx`

**Effort:** 1 hour. Low risk.

---

## Implementation Order

| Phase | What | Effort | Impact | Risk |
|-------|------|--------|--------|------|
| 1.1 | 80ms streaming flush | 30 min | Medium | Zero |
| 1.2 | useAIContext hook | 2 hrs | High | Medium |
| 2.1 | Resizable Sherpa panel | 1 hr | Medium | Low |
| 3.2 | Spring easing tokens | 10 min | Low | Zero |
| 3.1 | Design token module | 2 hrs | Medium | Low |
| 4.2 | Memory supersession | 1 hr | Medium | Low |
| 5.3 | Activity ticker | 1 hr | Low | Low |
| 6.1 | CommandPalette canned prompts | 1 hr | Medium | Low |
| 5.1 | Intelligence feed | 3 hrs | Medium | Low |
| 5.2 | Workspace health radar | 2 hrs | Low | Low |
| 4.3 | Living narratives | 2 hrs | Medium | Low |
| **4.1** | **Agent loop with tools** | **2-3 days** | **Transformative** | **Medium** |

**Total: ~5-6 days for everything. Phase 1 + 2 + 3 can ship in one session (~4 hours). Phase 4.1 (agent loop) is the big one that changes the intelligence ceiling.**

---

## Critical Rules

1. **No new Zod strictness.** Schemas validate structure (does this have a type field?), not content (is this operator in my enum?). The AI is smarter than our schemas.

2. **All tools execute client-side.** The agent loop runs in the browser, tools read from React state and Supabase. The edge function just does AI inference. This means no edge function changes for the tool system.

3. **80ms flush is the minimum viable streaming fix.** Ship it before anything else.

4. **useAIContext replaces buildIntentPayloadContext.** Don't maintain two context builders.

5. **Agent loop is optional per query.** Simple queries ("dissolve this card") don't need a tool loop. Complex queries ("why does this card show the wrong vendors?") do. The system should detect which path to take.

---

## What NOT to Change

- **data-slicer.ts** — remains pure, untouched
- **WorkspaceContext reducer** — no new action types
- **Existing card renderers** — AnalysisCard handles everything
- **Memory system** — extend, don't replace
- **Edge function prompts** — already rewritten, don't touch

---

## ⚠️ DEPLOYMENT ALERTS

Phase 4.2 and 4.3 require:
- New Supabase migrations (SQL Editor)
- Edge function redeployment IF memory queries change

Phase 4.1 requires:
- The Lovable AI gateway to support tool_calls/function_calling, OR
- Direct provider API keys (Anthropic/OpenAI) configured in edge function secrets
