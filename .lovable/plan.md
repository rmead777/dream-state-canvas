

# Dream State Workspace — Refined Architecture Plan

## 1. Workspace Object Model (not "panels")

Every surface in the workspace is a **WorkspaceObject** — a semantic entity, not a UI card.

```text
WorkspaceObject {
  id: string
  type: 'metric' | 'comparison' | 'alert' | 'inspector' | 'brief' | 'timeline' | 'monitor'
  title: string
  status: 'materializing' | 'open' | 'collapsed' | 'dissolved'
  pinned: boolean
  origin: IntentOrigin        // what caused this to exist
  relationships: string[]     // IDs of related objects
  context: Record<string,any> // data payload
  position: { zone: 'primary' | 'secondary' | 'peripheral', order: number }
  createdAt: number
  lastInteractedAt: number
}

IntentOrigin {
  type: 'user-query' | 'sherpa-suggestion' | 'cross-object' | 'system'
  query?: string              // original natural language
  sourceObjectId?: string     // if spawned from another object
}
```

Relationships are first-class: a comparison object knows which metric objects it relates to. When a parent collapses, related children dim. When a user drills into an object, related objects subtly highlight.

## 2. Intent-to-Object Mapping Layer

A dedicated `IntentEngine` module maps natural language → workspace actions. This is NOT inside the Sherpa UI component — it's a pure logic layer.

```text
src/lib/intent-engine.ts

- parseIntent(input: string) → IntentResult
- IntentResult { actions: WorkspaceAction[] }
- WorkspaceAction:
    | { type: 'create', objectType, title, data, relatedTo? }
    | { type: 'focus', objectId }
    | { type: 'dissolve', objectId }
    | { type: 'respond', message }
```

Pattern matching for v1 (keyword-based), structured so a real LLM can replace it later. The Sherpa UI calls the engine; the engine returns actions; the workspace state reducer executes them.

## 3. AI Sherpa as System Intelligence

The Sherpa is split into three layers:

- **SherpaEngine** (`src/lib/sherpa-engine.ts`): System-level intelligence. Observes workspace state, generates proactive suggestions, routes intents. Has access to all workspace objects, their relationships, and interaction history.
- **SherpaContext** (`src/contexts/SherpaContext.tsx`): React context providing engine state app-wide. Any component can read Sherpa suggestions or trigger intents.
- **SherpaRail** (`src/components/workspace/SherpaRail.tsx`): The UI surface. Renders input, suggestions, and concise responses. It's a *view* of the intelligence, not the intelligence itself.

Sherpa behaviors:
- Notices repeated interactions ("You've returned to leverage 3 times — pin it?")
- Suggests related objects when one is created
- Offers to dissolve stale objects
- Provides contextual suggestions based on what's currently open

## 4. Spatial Orchestration Rules

Objects don't just "appear" — they are placed by a **SpatialOrchestrator**.

Rules:
- **Primary zone** (center-left): Active focus objects. Max 2-3 visible at once.
- **Secondary zone** (below or beside primary): Supporting context. Related objects auto-place here.
- **Peripheral zone** (collapsed bar): Minimized chips.
- New objects materialize in primary zone; existing objects shift to secondary if space is needed.
- Related objects appear adjacent to their parent.
- When an object is focused (clicked/expanded), unrelated objects recede (opacity reduction, not removal).
- The workspace never shows more than 4 full objects simultaneously — density is earned, not default.

Implementation: `src/lib/spatial-orchestrator.ts` — a pure function that takes current workspace state and a new action, returns updated positions for all objects.

## 5. Cross-Object Intelligence

Objects are aware of each other:
- **Highlight propagation**: Hovering a metric in a comparison object highlights the same metric if it exists in a standalone metric object.
- **Contextual actions**: An alert object can offer "Show related metric" which creates/focuses the relevant object.
- **Relationship lines**: Subtle, optional visual connectors between related objects (thin lines or shared accent color).
- **Cascade behaviors**: Dissolving a parent offers to dissolve children. Collapsing dims related.

Implemented via the relationship graph in workspace state + a `CrossObjectBehavior` hook that watches state changes.

## 6. Expanded State Model

```text
WorkspaceState {
  objects: Record<string, WorkspaceObject>
  activeContext: {
    focusedObjectId: string | null
    recentIntents: IntentOrigin[]
    sessionStartedAt: number
  }
  sherpa: {
    suggestions: Suggestion[]
    lastResponse: string | null
    observations: string[]    // things Sherpa has noticed
  }
  spatialLayout: {
    primary: string[]         // object IDs in primary zone
    secondary: string[]
    peripheral: string[]
  }
}
```

Managed via React context + useReducer. Actions include: `MATERIALIZE_OBJECT`, `DISSOLVE_OBJECT`, `COLLAPSE_OBJECT`, `RESTORE_OBJECT`, `PIN_OBJECT`, `FOCUS_OBJECT`, `REFLOW_LAYOUT`, `ADD_SHERPA_OBSERVATION`.

## 7. Anti-Drift Constraints (Enforced in Architecture)

These are structural rules, not guidelines:

1. **No sidebar navigation.** The app has one route. Period.
2. **No tab bars.** Objects are summoned, not selected from a menu.
3. **No static dashboard grid.** Layout is dynamic, orchestrated by spatial rules.
4. **No chat bubble UI.** Sherpa responses are inline text blocks, not message bubbles.
5. **No always-visible action bars.** Actions appear contextually on hover/focus.
6. **Max 4 full objects visible.** The orchestrator enforces this ceiling.
7. **Empty space is never "filled" by default.** The initial screen has the Sherpa greeting and nothing else.
8. **No KPI cards on load.** Nothing appears until summoned or contextually warranted.
9. **Every object must have an IntentOrigin.** Nothing exists without a reason.

## 8. Motion as Causality

Motion communicates *why* something appeared, not just *that* it appeared:

- **Materialize**: Object scales from 0.96 + fades in from the direction of its origin (from Sherpa rail if user-queried, from parent object if cross-spawned).
- **Dissolve**: Fade out + slight scale down toward origin point.
- **Collapse**: Shrink to chip, animate toward peripheral zone.
- **Restore**: Chip expands from peripheral zone to its spatial position.
- **Focus shift**: Focused object slightly enlarges; others reduce opacity to 0.6.
- **Relationship highlight**: Subtle shared pulse or border glow between related objects.

All transitions use CSS transitions with `cubic-bezier(0.16, 1, 0.3, 1)` (smooth deceleration). No spring physics library needed for v1 — CSS is sufficient and lighter.

## File Structure

```text
src/
  contexts/
    WorkspaceContext.tsx      — state, reducer, provider
    SherpaContext.tsx          — Sherpa intelligence state
  lib/
    intent-engine.ts          — NL → workspace actions
    sherpa-engine.ts           — proactive intelligence logic
    spatial-orchestrator.ts    — layout placement rules
    workspace-types.ts         — all type definitions
    mock-data.ts               — realistic demo data
  components/
    workspace/
      WorkspaceShell.tsx       — root layout
      PanelCanvas.tsx          — renders objects by spatial zone
      WorkspaceObject.tsx      — universal object wrapper (motion, chrome)
      SherpaRail.tsx           — AI interface surface
      CollapsedBar.tsx         — peripheral zone chips
      RelationshipConnector.tsx — visual links between objects
    objects/
      MetricDetail.tsx
      ComparisonPanel.tsx
      AlertRiskPanel.tsx
      DataInspector.tsx
      AIBrief.tsx
      Timeline.tsx
  hooks/
    useCrossObjectBehavior.ts  — relationship-aware interactions
    useWorkspaceActions.ts     — convenience dispatch hooks
  pages/
    Index.tsx                  — single entry, renders WorkspaceShell
```

## Demo Flow

1. **Load**: Calm canvas. Sherpa greeting: "Good morning. What would you like to focus on?" Three subtle suggestion chips.
2. **"show leverage exposure"** → IntentEngine creates MetricDetail object → SpatialOrchestrator places in primary zone → materializes from Sherpa rail direction.
3. **"compare Alpha and Gamma"** → ComparisonPanel materializes in primary → MetricDetail shifts to secondary → relationship link established.
4. **"what should I focus on?"** → Sherpa responds inline + creates AlertRisk object with `origin: sherpa-suggestion` → appears in primary, others shift.
5. **Collapse** an object → dissolves to chip in peripheral bar. Related objects dim slightly.
6. **Click chip** → restores with animation from chip position to spatial slot.
7. **Hover** metric in comparison → if standalone metric object exists, it pulses subtly.

## Design Tokens (CSS Variables)

Updated palette in `index.css`:
- `--workspace-bg: 40 20% 98%` (warm pearl)
- `--workspace-surface: 40 15% 96%` (fog)
- `--workspace-accent: 234 60% 60%` (muted indigo)
- `--workspace-accent-subtle: 234 30% 90%`
- `--workspace-text: 220 20% 12%`
- `--workspace-text-secondary: 220 10% 50%`
- `--workspace-border: 220 15% 90%`
- `--workspace-shadow: 0 2px 12px rgba(0,0,0,0.04)`

## What This Enables Next

The architecture is structured so these additions require no refactoring:
- Real LLM integration (replace keyword matching in intent-engine)
- localStorage/server persistence (serialize WorkspaceState)
- Command palette (another intent input surface, same engine)
- Workspace memory across sessions
- Object registry for plugin-style new object types

