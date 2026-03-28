# Dynamic Card Intelligence — Implementation Specification

## Context for Claude Code

You are transforming how Sherpa creates workspace objects. Currently, the AI picks from 9 fixed card types and the data slicer fills each with templated content. The same alert card appears whether the user asks "which vendors are at risk?" or "which vendors have payment plans?" — because the slicer doesn't know the difference.

After this spec, every card can be unique to the query. The AI generates the card's actual content — data selection, narrative, visualizations, callouts — not just a type label. The existing fixed types remain as backwards-compatible shortcuts, but a new `analysis` super-type handles everything the AI wants to express.

**This is the highest-leverage change to the intent→manifestation pipeline since the app was created.**

**Key existing files:**
- `src/hooks/useWorkspaceActions.ts` — intent processing, action dispatch
- `src/lib/action-handlers.ts` — handleUpdate, handleFuse, handleRefineRules
- `src/lib/intent-engine.ts` — parseIntentAI, workspace context building
- `src/lib/intent-schema.ts` — Zod validation for LLM output
- `src/lib/data-slicer.ts` — pure data transforms (previewRows, alertRows, etc.)
- `src/lib/workspace-types.ts` — ObjectType, WorkspaceObject, etc.
- `src/components/objects/` — per-type renderers (MetricDetail, AlertRiskPanel, etc.)
- `supabase/functions/ai-chat/index.ts` — system prompts by mode

---

## Architecture Overview

### Current Pipeline (template-driven)
```
User query → AI picks type (metric/alert/brief/...) → Code runs fixed slicer → Template card
```
The AI's only decision: which of 9 types. Content is always the same DataProfile-driven slice.

### New Pipeline (AI-driven)
```
User query → AI generates card spec (type, sections, dataQuery, narrative) → Universal renderer
```
The AI decides: what to show, how to filter it, what to highlight, what narrative wraps it. The renderer interprets whatever the AI produces.

### Backwards Compatibility
All 9 existing types continue to work exactly as they do today. The `analysis` super-type is additive. Old cards render with old renderers. New cards render with the universal section renderer. No breaking changes.

---

## Phase 1: The Analysis Super-Type + DataQuery + Section Renderer

This is the core change. Three pieces that ship together.

### 1.1 Add `analysis` to ObjectType

In `src/lib/workspace-types.ts`:

```typescript
export type ObjectType =
  | 'metric' | 'comparison' | 'alert' | 'inspector' | 'brief'
  | 'timeline' | 'monitor' | 'document' | 'dataset'
  | 'analysis';  // <-- new: flexible AI-generated content
```

### 1.2 Card Section Schema

Create `src/lib/card-schema.ts`:

```typescript
import { z } from 'zod';

// ─── Section Types ───────────────────────────────────────────────────────────

export const SummarySection = z.object({
  type: z.literal('summary'),
  text: z.string(),
});

export const NarrativeSection = z.object({
  type: z.literal('narrative'),
  text: z.string(),  // Markdown supported
});

export const MetricSection = z.object({
  type: z.literal('metric'),
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  unit: z.string().optional(),
  trend: z.enum(['up', 'down', 'flat']).optional(),
  trendLabel: z.string().optional(),
});

export const TableSection = z.object({
  type: z.literal('table'),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
  highlights: z.array(z.object({
    column: z.string(),
    condition: z.string(),   // e.g., ">90", "contains:overdue"
    style: z.enum(['warning', 'danger', 'success', 'info']),
  })).optional(),
  caption: z.string().optional(),
});

export const CalloutSection = z.object({
  type: z.literal('callout'),
  severity: z.enum(['info', 'warning', 'danger', 'success']),
  text: z.string(),
});

export const MetricsRowSection = z.object({
  type: z.literal('metrics-row'),
  metrics: z.array(z.object({
    label: z.string(),
    value: z.union([z.string(), z.number()]),
    unit: z.string().optional(),
  })),
});

export const ChartSection = z.object({
  type: z.literal('chart'),
  chartType: z.enum(['bar', 'line', 'area']),
  xAxis: z.string(),
  yAxis: z.string(),
  data: z.array(z.record(z.union([z.string(), z.number()]))),
  caption: z.string().optional(),
});

export const CardSection = z.discriminatedUnion('type', [
  SummarySection,
  NarrativeSection,
  MetricSection,
  TableSection,
  CalloutSection,
  MetricsRowSection,
  ChartSection,
]);

export type CardSection = z.infer<typeof CardSection>;

// ─── DataQuery Schema ────────────────────────────────────────────────────────

export const DataQuerySchema = z.object({
  filter: z.object({
    column: z.string(),
    operator: z.enum(['equals', 'contains', 'gt', 'lt', 'gte', 'lte']).default('contains'),
    value: z.union([z.string(), z.number()]),
  }).optional(),
  filters: z.array(z.object({
    column: z.string(),
    operator: z.enum(['equals', 'contains', 'gt', 'lt', 'gte', 'lte']),
    value: z.union([z.string(), z.number()]),
  })).optional(),
  columns: z.array(z.string()).optional(),     // which columns to include
  sort: z.object({
    column: z.string(),
    direction: z.enum(['asc', 'desc']),
  }).optional(),
  limit: z.number().optional(),
  groupBy: z.string().optional(),
}).optional();

export type DataQuery = z.infer<typeof DataQuerySchema>;

// ─── Analysis Card Content ───────────────────────────────────────────────────

export const AnalysisContentSchema = z.object({
  sections: z.array(CardSection),
  dataQuery: DataQuerySchema.optional(),
});

export type AnalysisContent = z.infer<typeof AnalysisContentSchema>;
```

### 1.3 Update Intent Schema

In `src/lib/intent-schema.ts`, update the `CreateActionSchema`:

```typescript
export const ObjectTypeSchema = z.enum([
  'metric', 'comparison', 'alert', 'inspector', 'brief',
  'timeline', 'monitor', 'document', 'dataset',
  'analysis',  // <-- add
]);

// Update CreateActionSchema to accept optional sections + dataQuery
export const CreateActionSchema = z.object({
  type: z.literal('create'),
  objectType: ObjectTypeSchema,
  title: z.string().min(1).default('Untitled'),
  relatedTo: z.array(z.string()).optional(),
  sections: z.array(CardSection).optional(),     // <-- new: AI-generated content
  dataQuery: DataQuerySchema.optional(),          // <-- new: data selection spec
});
```

### 1.4 Update the AI System Prompt

In `supabase/functions/ai-chat/index.ts`, update the `intent` system prompt to teach the AI about dynamic card generation:

Add after the existing action schema documentation:

```
ADVANCED CARD CREATION:

When you create cards, you can generate rich, query-specific content instead of relying on generic types.

For complex or specific questions, use objectType: "analysis" with a "sections" array:

{
  "type": "create",
  "objectType": "analysis",
  "title": "Payment Plan Status — Active Vendors",
  "sections": [
    { "type": "summary", "text": "3 vendors have active payment plans totaling $167K" },
    { "type": "table",
      "columns": ["Vendor", "Plan Amount", "Status", "Last Contact"],
      "rows": [["Acme-Hardesty", "$72,400", "In Progress", "3/15"], ...] },
    { "type": "callout", "severity": "warning", "text": "Acme-Hardesty plan is stalling — no response since 3/5" }
  ]
}

Available section types: summary, narrative, metric, table, callout, metrics-row, chart.

You can also include a "dataQuery" to specify which data to filter and how:

{
  "type": "create",
  "objectType": "inspector",
  "title": "Vendors Over $500K",
  "dataQuery": {
    "filter": { "column": "Balance", "operator": "gt", "value": 500000 },
    "sort": { "column": "Balance", "direction": "desc" },
    "columns": ["Vendor", "Balance", "Tier", "Days Outstanding"],
    "limit": 10
  }
}

RULES FOR CARD CREATION:
- Use "analysis" with sections when the user asks something specific that doesn't fit a standard type.
- Use standard types (metric, alert, inspector, etc.) for common requests, but include dataQuery when the user specifies filters.
- When creating sections, use the ACTUAL DATA from the workspace context to populate table rows, metrics, and callouts. Do NOT invent data — use values from the dataset.
- Title should reflect the user's actual question, not a generic label like "AP Exposure."
- If the workspace already has a card showing similar data, create a DIFFERENT view — zoom into a sub-segment, compare a different dimension, or surface what the existing card doesn't show.
```

### 1.5 Analysis Card Renderer

Create `src/components/objects/AnalysisCard.tsx`:

```typescript
/**
 * AnalysisCard — universal renderer for AI-generated structured content.
 *
 * Interprets a sections array where each section can be:
 * summary, narrative, metric, table, callout, metrics-row, chart
 *
 * This is the rendering backbone for the "analysis" super-type.
 * The AI decides the structure; this component renders whatever it produces.
 */
```

The component should:
- Accept `object.context.sections` (validated by Zod on creation)
- Render each section type with workspace-consistent styling
- Handle missing/malformed sections gracefully (skip, don't crash)
- Use existing design tokens (workspace-surface, workspace-accent, etc.)

Section renderers (all internal to this file or split into a sections/ folder):

| Section Type | Renderer | Notes |
|-------------|----------|-------|
| `summary` | Single text block, slightly larger font, accent-tinted | The "headline" of the card |
| `narrative` | MarkdownRenderer (already exists) | Reuse existing markdown component |
| `metric` | Large number + label + optional trend arrow | Similar to MetricDetail's hero number |
| `table` | VirtualizedTable (already exists from HI-012) | With highlight support for conditional formatting |
| `callout` | Colored left-border card with severity icon | warning=amber, danger=red, success=green, info=blue |
| `metrics-row` | Horizontal row of 2-4 mini metric cards | For multi-metric summaries |
| `chart` | Recharts wrapper (already in deps) | Bar, line, area per AI spec |

### 1.6 DataQuery Executor

Create `src/lib/data-query.ts`:

```typescript
/**
 * DataQuery Executor — runs AI-generated data queries against the active dataset.
 *
 * Translates the DataQuery schema (filter, sort, columns, limit, groupBy)
 * into actual data operations. Uses the existing dataset from active-dataset.ts.
 *
 * This is the bridge between the AI's data selection intent and the actual data.
 * The slicer (data-slicer.ts) remains unchanged — this is a parallel path
 * for dynamic queries, not a replacement.
 */

import { getActiveDataset } from './active-dataset';
import { DataQuery } from './card-schema';

export interface QueryResult {
  columns: string[];
  rows: (string | number | null)[][];
  totalMatched: number;
  truncated: boolean;
}

export function executeDataQuery(query: DataQuery): QueryResult {
  const { columns: allColumns, rows: allRows } = getActiveDataset();
  let rows = [...allRows];

  // 1. Apply filters
  if (query?.filter) {
    rows = applyFilter(rows, allColumns, query.filter);
  }
  if (query?.filters) {
    for (const f of query.filters) {
      rows = applyFilter(rows, allColumns, f);
    }
  }

  // 2. Apply sort
  if (query?.sort) {
    const colIdx = allColumns.indexOf(query.sort.column);
    if (colIdx >= 0) {
      rows.sort((a, b) => {
        const va = a[colIdx], vb = b[colIdx];
        const na = Number(va), nb = Number(vb);
        const cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : String(va).localeCompare(String(vb));
        return query.sort!.direction === 'desc' ? -cmp : cmp;
      });
    }
  }

  // 3. Select columns
  const selectedColumns = query?.columns
    ? query.columns.filter(c => allColumns.includes(c))
    : allColumns;
  const colIndices = selectedColumns.map(c => allColumns.indexOf(c));

  const totalMatched = rows.length;

  // 4. Apply limit
  if (query?.limit) {
    rows = rows.slice(0, query.limit);
  }

  // 5. Project columns
  const projected = rows.map(row => colIndices.map(i => row[i]));

  return {
    columns: selectedColumns,
    rows: projected,
    totalMatched,
    truncated: query?.limit ? totalMatched > query.limit : false,
  };
}

function applyFilter(
  rows: string[][],
  columns: string[],
  filter: { column: string; operator: string; value: string | number }
): string[][] {
  const colIdx = columns.indexOf(filter.column);
  if (colIdx < 0) return rows;

  return rows.filter(row => {
    const cell = row[colIdx];
    const val = filter.value;

    switch (filter.operator) {
      case 'equals': return String(cell).toLowerCase() === String(val).toLowerCase();
      case 'contains': return String(cell).toLowerCase().includes(String(val).toLowerCase());
      case 'gt': return Number(cell) > Number(val);
      case 'lt': return Number(cell) < Number(val);
      case 'gte': return Number(cell) >= Number(val);
      case 'lte': return Number(cell) <= Number(val);
      default: return true;
    }
  });
}
```

### 1.7 Wire Into Action Handlers

In `src/lib/action-handlers.ts` or `src/hooks/useWorkspaceActions.ts`, when the AI returns a `create` action:

```typescript
// In the create handler:
case 'create': {
  let context = action.data || {};

  // If AI provided sections (analysis card or enhanced standard card)
  if (action.sections) {
    context = { ...context, sections: action.sections };
  }

  // If AI provided a dataQuery, execute it and merge results into context
  if (action.dataQuery) {
    const queryResult = executeDataQuery(action.dataQuery);
    context = {
      ...context,
      columns: queryResult.columns,
      rows: queryResult.rows,
      dataQuery: action.dataQuery,  // preserve for re-execution on update
      queryMeta: {
        totalMatched: queryResult.totalMatched,
        truncated: queryResult.truncated,
      },
    };
  }

  // ... rest of existing create logic (materialize, open after 400ms) ...
}
```

### 1.8 ObjectContent Dispatch

In `src/components/workspace/WorkspaceObject.tsx`, add the analysis renderer:

```typescript
import { AnalysisCard } from '@/components/objects/AnalysisCard';

function ObjectContent({ object }: { object: WorkspaceObject }) {
  switch (object.type) {
    case 'metric': return <MetricDetail object={object} />;
    case 'comparison': return <ComparisonPanel object={object} />;
    case 'alert': return <AlertRiskPanel object={object} />;
    // ... existing types ...
    case 'analysis': return <AnalysisCard object={object} />;
    default: return <div>Unknown object type</div>;
  }
}
```

Also: if ANY card type has `context.sections`, render with AnalysisCard. This lets the AI enhance standard types with custom sections:

```typescript
// If the object has sections in context, use the universal renderer
// regardless of type — the AI decided this card needs custom content
if (object.context?.sections?.length > 0) {
  return <AnalysisCard object={object} />;
}
```

---

## Phase 2: Cross-Card Awareness (Prompt Engineering Only)

No new code — just improve the workspace context that's passed to the AI.

### 2.1 Richer Workspace Context

In `src/lib/intent-engine.ts`, update `buildWorkspaceContext()` to include:

```typescript
function buildWorkspaceContext(objects: Record<string, WorkspaceObject>): string {
  const active = Object.values(objects).filter(o => o.status !== 'dissolved');
  if (active.length === 0) return 'Workspace is empty.';

  const lines = active.map(o => {
    const base = `[${o.id}] ${o.type}: "${o.title}" (${o.status})`;

    // Include data summary so the AI knows what's already shown
    const dataSummary = [];
    if (o.context?.rows?.length) dataSummary.push(`showing ${o.context.rows.length} rows`);
    if (o.context?.alerts?.length) dataSummary.push(`${o.context.alerts.length} alerts`);
    if (o.context?.dataQuery) dataSummary.push(`filtered by: ${JSON.stringify(o.context.dataQuery)}`);
    if (o.context?.sections?.length) dataSummary.push(`${o.context.sections.length} sections`);

    return dataSummary.length > 0 ? `${base} — ${dataSummary.join(', ')}` : base;
  });

  return lines.join('\n');
}
```

### 2.2 Add Non-Repetition Instruction

Add to the intent system prompt:

```
WORKSPACE AWARENESS:
- Before creating a card, check the workspace context above.
- If a card already shows similar data, DO NOT duplicate it.
- Instead: zoom into a sub-segment, compare a different dimension, or surface what existing cards DON'T show.
- If the user asks "what else?" or "anything I'm missing?", explicitly exclude what's already visible and find the next layer of insight.
- Title new cards to differentiate them from existing ones (e.g., "Tier 2 Watchlist" instead of another "Urgent Vendors").
```

---

## Phase 3: Progressive Refinement + Entity Intelligence

### 3.1 Section-Level Updates

When the user says "add a chart to that card" or "remove the table," the AI should modify the existing card's sections rather than creating a new card.

Update the `update` action to support section operations:

```typescript
// In intent-schema.ts, extend UpdateActionSchema:
export const UpdateActionSchema = z.object({
  type: z.literal('update'),
  objectId: z.string().min(1),
  instruction: z.string().min(1),
  sectionOperations: z.array(z.discriminatedUnion('op', [
    z.object({ op: z.literal('add'), section: CardSection }),
    z.object({ op: z.literal('remove'), sectionIndex: z.number() }),
    z.object({ op: z.literal('replace'), sectionIndex: z.number(), section: CardSection }),
    z.object({ op: z.literal('requery'), dataQuery: DataQuerySchema }),
  ])).optional(),
});
```

In `handleUpdate`, if `sectionOperations` are present:

```typescript
if (action.sectionOperations && target.context?.sections) {
  let sections = [...target.context.sections];
  for (const op of action.sectionOperations) {
    switch (op.op) {
      case 'add': sections.push(op.section); break;
      case 'remove': sections.splice(op.sectionIndex, 1); break;
      case 'replace': sections[op.sectionIndex] = op.section; break;
      case 'requery': {
        const result = executeDataQuery(op.dataQuery);
        // Update the table section with new data
        const tableIdx = sections.findIndex(s => s.type === 'table');
        if (tableIdx >= 0) {
          sections[tableIdx] = { ...sections[tableIdx], columns: result.columns, rows: result.rows };
        }
        break;
      }
    }
  }
  return { ...target.context, sections };
}
```

### 3.2 Entity Memory → Card Intelligence

The entity memory type (from the Memory Architecture) feeds directly into card creation. When Sherpa has entity memories, they're already injected into the system prompt via the memory retriever.

To make entity knowledge actionable in cards:

Add to the intent system prompt:

```
ENTITY AWARENESS:
- If your Sherpa Memory includes entity knowledge (people, companies, relationships), use it to personalize cards.
- "Who should I call about Acme?" → create an analysis card with the contact info from memory, not a generic vendor card.
- Entity relationships can drive card content: "Holly Johnson has engaged with 3 of the 5 Tier 1 vendors" is a valid callout section.
- When creating people-centric views, use the entity memory to populate names, roles, and relationships.
```

No new code needed — the memory retriever already injects entity memories. The AI just needs permission to use them in card content.

---

## Implementation Order

| Phase | What | Effort | Dependencies |
|-------|------|--------|-------------|
| 1a | `card-schema.ts` — Zod schemas for sections + dataQuery | 0.5 day | None |
| 1b | `data-query.ts` — query executor | 0.5 day | 1a |
| 1c | `AnalysisCard.tsx` — universal section renderer | 1 day | 1a |
| 1d | Intent schema + system prompt updates | 0.5 day | 1a |
| 1e | Wire into action handlers + ObjectContent dispatch | 0.5 day | 1a-1d |
| 2 | Workspace context enrichment + non-repetition prompt | 0.5 day | Phase 1 |
| 3a | Section-level update operations | 1 day | Phase 1 |
| 3b | Entity memory → card intelligence (prompt only) | 0.25 day | Memory system |

**Total: ~4-5 days for all phases. Phase 1 alone (3 days) transforms the core experience.**

---

## Critical Rules (Do Not Violate)

1. **Existing card types MUST continue working.** The `analysis` type is additive. No existing renderer should break. If the AI returns `{ type: 'metric' }` without sections, it renders exactly as before.

2. **Sections are validated by Zod at creation time.** Malformed AI output is caught before it reaches the renderer. Use `CardSection.safeParse()` — invalid sections are dropped, not crash the card.

3. **The data-query executor is a pure function.** It reads from `getActiveDataset()` and returns results. It does NOT modify state, call APIs, or interact with the slicer. The slicer and query executor are parallel paths, not replacements.

4. **DataQuery results are stored in object context.** This means the card can re-render without re-executing the query. On "update," the query can be re-executed with modified parameters.

5. **The AnalysisCard must handle ALL section types gracefully.** Unknown section types are skipped (not crashed). Missing optional fields use sensible defaults. This is AI-generated content — expect imperfection.

6. **AI-generated table rows must come from actual data.** The system prompt instructs the AI to use values from the workspace context, not invent data. But the dataQuery path is preferred because it guarantees real data — AI-generated rows are a fallback for cases where the AI is synthesizing across multiple sources.

7. **Cross-card awareness is soft guidance, not enforcement.** The AI may still occasionally create similar cards. The prompt discourages it, but the user can always dissolve duplicates. Don't add code to block "similar" card creation — that's over-engineering.

---

## What NOT to Change

- `data-slicer.ts` — remains unchanged. Dynamic queries use `data-query.ts`, not modified slicers.
- Existing object renderers (MetricDetail, AlertRiskPanel, etc.) — untouched.
- Fusion system — untouched. Fusion creates briefs, not analysis cards.
- Memory system — untouched. Entity memories are already injected into prompts.
- Workspace reducer — no new action types needed. `MATERIALIZE_OBJECT` handles analysis cards with sections in context.

---

## Expected Outcome

**Before:** "Which vendors have payment plans?" → generic alert card with same 5 vendors as every other risk query.

**After:** "Which vendors have payment plans?" → analysis card titled "Active Payment Plans" with:
- Summary: "3 vendors have active payment plans totaling $167K"
- Table: specifically filtered to vendors with payment plan mentions, columns relevant to payment status
- Callout: "Acme-Hardesty plan is stalling — no response since 3/5"

**Before:** "What's our biggest risk?" and "What's our smallest risk?" → same alert card both times.

**After:** First query → analysis card with top 5 by exposure. Second query → analysis card with the low-balance vendors that are aging fastest, because the AI chose different filters and different narrative.

**Before:** All metric cards show the same number. All inspector cards show the same top vendors.

**After:** "Show me exposure by region" → metric card with dataQuery filtering by region column. "Show vendors over $500K" → inspector card with dataQuery filtering Balance > 500000. Different questions, different data, same card types.
