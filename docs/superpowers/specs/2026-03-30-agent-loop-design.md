# Sherpa Agent Loop — Design Specification

**Date:** 2026-03-30
**Status:** Approved
**Approach:** Client-side agent loop (Option B)
**UX:** Status line updates during tool execution (Option 2)

---

## Overview

Transform Sherpa from a single-turn intent parser into a tool-using agent. The client orchestrates a multi-turn loop: send query → AI returns tool_calls → client executes tools → send results back → AI responds or calls more tools → repeat until done.

This enables Sherpa to look things up, verify its work, and take multiple steps before responding. "Why does this card show the wrong vendors?" becomes answerable because the AI can read the card's actual data.

---

## Architecture

```
User sends query
  │
  ▼
sherpa-agent.ts: agentLoop(query, context, tools)
  │
  ├── Build messages: [system prompt, conversation history, workspace context, user query]
  ├── Include tool definitions in the request
  │
  ▼
  ┌─── LOOP (max 5 iterations) ───────────────────────┐
  │                                                     │
  │  Call edge function (ai-chat) with messages + tools │
  │         │                                           │
  │         ▼                                           │
  │  AI response contains tool_calls?                   │
  │    YES → Execute each tool client-side              │
  │         → Update status line ("Reading card data...") │
  │         → Append tool results to messages            │
  │         → Continue loop                             │
  │    NO  → Extract response + actions                 │
  │         → Return to caller                          │
  │                                                     │
  └─────────────────────────────────────────────────────┘
  │
  ▼
useWorkspaceActions: applyResult(actions) — existing pipeline
```

### What stays the same
- Edge function proxies AI calls — no loop logic server-side
- `applyResult()` dispatches actions to the reducer — unchanged
- Existing card renderers, memory system, data pipeline — untouched
- Simple queries (AI responds on first call, no tool_calls) — zero overhead

### What changes
- `parseIntentAI` replaced by `agentLoop` as the primary entry point
- Edge function system prompt updated to describe available tools
- Edge function passes `tools` array through to the AI provider
- SherpaRail shows status line during multi-step execution

---

## Tool Definitions

### Read Tools (access workspace data)

**getCardData** — Get the full data of a specific card
```typescript
{
  name: 'getCardData',
  description: 'Get the full data (rows, columns, sections, filters, title, type) of a specific workspace card. Use this to understand what a card currently shows before modifying it.',
  parameters: {
    type: 'object',
    properties: {
      objectId: { type: 'string', description: 'The card ID (e.g., "wo-12345")' }
    },
    required: ['objectId']
  }
}
```
**Executor:** Reads from workspace state `objects[objectId]`, returns `{ type, title, context, status }`.

**queryDataset** — Run a filter/sort/limit query against the active dataset
```typescript
{
  name: 'queryDataset',
  description: 'Query the active dataset with filters, sorting, column selection, and limits. Returns matching rows. Use this when you need to find specific data to answer a question or populate a card.',
  parameters: {
    type: 'object',
    properties: {
      filter: { type: 'object', properties: { column: { type: 'string' }, operator: { type: 'string' }, value: {} } },
      filters: { type: 'array', items: { type: 'object' } },
      columns: { type: 'array', items: { type: 'string' } },
      sort: { type: 'object', properties: { column: { type: 'string' }, direction: { type: 'string', enum: ['asc', 'desc'] } } },
      limit: { type: 'number' }
    }
  }
}
```
**Executor:** Calls `executeDataQuery()` from `data-query.ts`, returns `{ columns, rows, totalMatched, truncated }`.

**getWorkspaceState** — Get all cards on the canvas
```typescript
{
  name: 'getWorkspaceState',
  description: 'Get a summary of all cards currently on the workspace canvas, including their IDs, types, titles, statuses, and which one is focused.',
  parameters: { type: 'object', properties: {} }
}
```
**Executor:** Reads workspace state, returns array of `{ id, type, title, status, isFocused, rowCount }`.

**searchData** — Full-text search across all dataset rows
```typescript
{
  name: 'searchData',
  description: 'Search across all rows in the active dataset for a text match. Returns matching rows with all columns.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text to search for' },
      column: { type: 'string', description: 'Optional: limit search to this column' },
      limit: { type: 'number', description: 'Max rows to return (default 20)' }
    },
    required: ['query']
  }
}
```
**Executor:** Iterates dataset rows, case-insensitive partial match. Returns matching rows.

**getDocumentContent** — Get extracted text from an uploaded document
```typescript
{
  name: 'getDocumentContent',
  description: 'Get the extracted text and structured data from an uploaded document.',
  parameters: {
    type: 'object',
    properties: {
      documentId: { type: 'string' }
    },
    required: ['documentId']
  }
}
```
**Executor:** Calls `getDocument(id)` from `document-store.ts`, returns extracted text + metadata.

### Write Tools (modify workspace)

**updateCard** — Modify an existing card's data, sections, or title
```typescript
{
  name: 'updateCard',
  description: 'Update an existing card on the canvas. Can change its data query (filter/sort/limit), replace sections, change title, or any combination.',
  parameters: {
    type: 'object',
    properties: {
      objectId: { type: 'string' },
      dataQuery: { type: 'object' },
      sections: { type: 'array' },
      title: { type: 'string' }
    },
    required: ['objectId']
  }
}
```
**Executor:** Dispatches through `handleUpdate` or directly via `UPDATE_OBJECT_CONTEXT`.

**createCard** — Create a new card on the canvas
```typescript
{
  name: 'createCard',
  description: 'Create a new card on the workspace canvas.',
  parameters: {
    type: 'object',
    properties: {
      objectType: { type: 'string' },
      title: { type: 'string' },
      dataQuery: { type: 'object' },
      sections: { type: 'array' }
    },
    required: ['objectType', 'title']
  }
}
```
**Executor:** Dispatches `MATERIALIZE_OBJECT` through existing pipeline.

**dissolveCard** — Remove a card from the canvas
```typescript
{
  name: 'dissolveCard',
  description: 'Remove a card from the workspace.',
  parameters: {
    type: 'object',
    properties: {
      objectId: { type: 'string' }
    },
    required: ['objectId']
  }
}
```
**Executor:** Dispatches `DISSOLVE_OBJECT`.

**focusCard** — Bring a card to the user's attention
```typescript
{
  name: 'focusCard',
  description: 'Focus on a specific card, bringing it to the user\'s attention.',
  parameters: {
    type: 'object',
    properties: {
      objectId: { type: 'string' }
    },
    required: ['objectId']
  }
}
```
**Executor:** Dispatches `FOCUS_OBJECT`.

### Memory Tools

**rememberFact** — Store something in long-term memory
```typescript
{
  name: 'rememberFact',
  description: 'Store a fact, preference, correction, or pattern in Sherpa\'s long-term memory. Use this when the user tells you to remember something, or when you detect a correction.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['correction', 'preference', 'entity', 'pattern', 'anti-pattern'] },
      content: { type: 'string' },
      reasoning: { type: 'string' }
    },
    required: ['type', 'content']
  }
}
```
**Executor:** Calls `createMemory()` from `memory-store.ts`.

**recallMemories** — Search memories relevant to a query
```typescript
{
  name: 'recallMemories',
  description: 'Search Sherpa\'s long-term memory for facts, preferences, or corrections relevant to the current context.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' }
    },
    required: ['query']
  }
}
```
**Executor:** Calls `retrieveRelevantMemories()` from `memory-retriever.ts`.

---

## Agent Loop Implementation

### sherpa-agent.ts

```typescript
interface AgentLoopParams {
  query: string;
  workspaceState: Record<string, WorkspaceObject>;
  activeContext: ActiveContext;
  documentIds: string[];
  conversationHistory: Message[];
  memories: string;
  maxIterations?: number;
  onStatusUpdate?: (status: string) => void;
}

interface AgentLoopResult {
  response: string;
  actions: WorkspaceAction[];
  toolCallsUsed: number;
}
```

The loop:
1. Build initial messages (system prompt context + conversation history + user query)
2. Call `callAI()` with `tools` parameter — edge function passes tools to the provider
3. Parse response — check for `tool_calls` in the AI output
4. If tool_calls present:
   - Execute each tool client-side via `executeTool()`
   - Call `onStatusUpdate()` with descriptive status
   - Append tool results as `role: "tool"` messages
   - Increment iteration counter
   - Loop back to step 2
5. If no tool_calls (or max iterations reached):
   - Extract response text + actions from the final AI message
   - Return result

### Tool Execution

```typescript
// sherpa-tools.ts
async function executeTool(
  name: string,
  args: Record<string, any>,
  context: { state: WorkspaceState; dispatch: Dispatch }
): Promise<string> {
  switch (name) {
    case 'getCardData': {
      const obj = context.state.objects[args.objectId];
      if (!obj) return JSON.stringify({ error: 'Card not found' });
      return JSON.stringify({
        id: obj.id, type: obj.type, title: obj.title, status: obj.status,
        rowCount: obj.context?.rows?.length,
        columns: obj.context?.columns,
        rows: obj.context?.rows?.slice(0, 10), // first 10 rows
        dataQuery: obj.context?.dataQuery,
        sections: obj.context?.sections,
      });
    }
    case 'queryDataset': {
      const result = executeDataQuery(args);
      return JSON.stringify(result);
    }
    // ... other tools
  }
}
```

Tool results are stringified JSON. The AI receives them as message content and can reason about them.

### Status Line

In SherpaRail, the processing indicator area shows tool execution status:

```
● Reading card data...
● Querying dataset...
● Composing response...
```

The `onStatusUpdate` callback from the agent loop sets this text. When the loop finishes, the status clears and the response renders normally.

Status messages per tool:
- `getCardData` → "Reading card data..."
- `queryDataset` → "Querying dataset..."
- `searchData` → "Searching data..."
- `getWorkspaceState` → "Checking workspace..."
- `getDocumentContent` → "Reading document..."
- `updateCard` → "Updating card..."
- `createCard` → "Creating card..."
- `dissolveCard` → "Removing card..."
- `focusCard` → "Focusing card..."
- `rememberFact` → "Saving to memory..."
- `recallMemories` → "Checking memory..."

---

## Edge Function Changes

The edge function needs two changes:

1. **Accept tools in the request body** — the client sends `tools: [...]` alongside `messages` and `mode`. The edge function passes them to the provider.

2. **Return tool_calls in the response** — currently the edge function streams `choices[0].delta.content`. For tool calls, the response includes `choices[0].delta.tool_calls`. The SSE format already supports this (OpenAI-compatible format). The Anthropic adapter in provider-router.ts needs to map Anthropic's `tool_use` blocks to OpenAI's `tool_calls` format.

3. **System prompt update** — add a section describing available tools so the AI knows it CAN use them. The tool definitions are sent as function parameters, but the system prompt should explain WHEN to use tools vs respond directly.

**⚠️ DEPLOYMENT NEEDED** after these changes — edge function redeployment required.

---

## Integration with Existing Pipeline

### useWorkspaceActions changes

`processIntent` currently calls `parseIntentAI()` directly. After this change:

```typescript
// Before:
const result = await parseIntentAI(query, state.objects, _documentIdsRef, state.activeContext, memoryBlock);

// After:
const result = await agentLoop({
  query,
  workspaceState: state.objects,
  activeContext: state.activeContext,
  documentIds: _documentIdsRef,
  conversationHistory: getConversationMessages(contextWindow),
  memories: memoryBlock,
  maxIterations: adminSettings.agentMaxIterations || 5,
  onStatusUpdate: (status) => dispatch({ type: 'SET_SHERPA_PROCESSING_STATUS', payload: status }),
});
```

The agent loop returns the same `{ response, actions }` shape as `parseIntentAI` — so `applyResult()` and everything downstream is untouched.

### Fallback

If the AI provider doesn't support tool calling (e.g., some models on the Lovable gateway), the agent loop degrades gracefully: the AI just returns a response with no tool_calls, and the loop completes in 1 iteration — identical to the current behavior.

---

## Admin Controls

Add to admin panel:
- **Agent max iterations** slider (1-10, default 5)
- Tool calling can be disabled entirely (checkbox) for debugging

---

## What NOT to change

- `data-slicer.ts` — untouched
- `data-query.ts` — already exists, tools call it
- `WorkspaceContext reducer` — no new action types. Write tools dispatch through `applyResult()` using existing actions.
- `Card renderers` — untouched
- `Memory system` — tools call existing functions

---

## Implementation Order

1. `src/lib/sherpa-tools.ts` — tool definitions + executors
2. `src/lib/sherpa-agent.ts` — agent loop orchestrator
3. `supabase/functions/ai-chat/index.ts` — accept tools, pass to provider, return tool_calls
4. `supabase/functions/_shared/provider-router.ts` — Anthropic adapter for tool_use → tool_calls mapping
5. `src/hooks/useWorkspaceActions.ts` — replace parseIntentAI with agentLoop
6. `src/components/workspace/SherpaRail.tsx` — status line for tool execution
7. `src/lib/admin-settings.ts` — agentMaxIterations setting
