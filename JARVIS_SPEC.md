# Dream State Canvas — Project JARVIS Implementation Spec

## Overview

This spec translates the Sherpa Evolution Roadmap into actionable engineering tasks, anchored to the existing codebase. Each item lists the exact files that change, the schema extension or API contract, and the key technical decision.

Current section type registry lives in `src/lib/card-schema.ts`. New section types follow the same pattern: add a Zod schema, add to the `CardSection` discriminated union, add a renderer in `src/components/objects/AnalysisCard.tsx`, and update the system prompt in `supabase/functions/ai-chat/index.ts`.

---

## Phase 1 — Visual Intelligence

### 1. Vega-Lite Section Type

**What:** A `vegalite` section type that accepts a standard Vega-Lite JSON spec and renders it via `vega-embed`. Expands chart vocabulary from 4 types (bar/line/area) to 50+ (scatter, heatmap, treemap, waterfall, Sankey, gauge, donut, radial, boxplot, etc.) without any renderer changes.

**Files:**
- `src/lib/card-schema.ts` — add `VegaLiteSection`:
  ```ts
  export const VegaLiteSection = z.object({
    type: z.literal('vegalite'),
    spec: z.record(z.any()),   // full Vega-Lite JSON spec
    height: z.number().optional(),
    caption: z.string().optional(),
  });
  ```
  Add to `CardSection` discriminated union.

- `src/components/objects/AnalysisCard.tsx` — add `VegaLiteRenderer`:
  ```tsx
  import embed from 'vega-embed';
  // useEffect → embed(ref.current, section.spec, { actions: false, theme: 'latimes' })
  ```

- `supabase/functions/ai-chat/index.ts` — extend section type docs with `vegalite` example spec.

**Install:** `npm install vega vega-lite vega-embed` (~150KB gzipped, lazy-loadable)

**AI guidance:** The system prompt should include a short example spec (a scatter plot is ideal) to teach the model the format. The model already knows Vega-Lite well — it just needs to know the section type exists.

**Decision:** Lazy-load vega-embed with `React.lazy` + `Suspense` to avoid adding ~150KB to the main bundle.

---

### 2. Color Theme System

**What:** A `theme` parameter on `chart` and `vegalite` sections — named palettes like `"frosted"`, `"corporate"`, `"neon"`, `"midnight"`, `"earth"`. Removes the need to manually specify hex codes.

**Files:**
- New file `src/lib/chart-themes.ts`:
  ```ts
  export const CHART_THEMES: Record<string, { colors: string[]; background: string; text: string }> = {
    frosted:    { colors: ['#6366f1','#06b6d4','#10b981','#f59e0b','#ef4444'], ... },
    corporate:  { colors: ['#1e3a5f','#2563eb','#0ea5e9','#64748b','#94a3b8'], ... },
    neon:       { colors: ['#00ff88','#00d4ff','#ff006e','#fb5607','#ffbe0b'], ... },
    midnight:   { colors: ['#818cf8','#a78bfa','#c084fc','#e879f9','#f472b6'], ... },
    earth:      { colors: ['#78350f','#b45309','#d97706','#65a30d','#047857'], ... },
  };
  ```
- `src/lib/card-schema.ts` — add `theme: z.string().optional()` to `ChartSection`.
- `src/components/objects/AnalysisCard.tsx` — `ChartRenderer` resolves `section.theme` via `CHART_THEMES`, falls back to existing `colors`/`color` fields.
- System prompt: add `theme: "frosted"` to chart section example.

**Effort:** 1 day. No new dependencies.

---

### 3. Multi-Chart Layout Grid (`chart-grid` section)

**What:** A `chart-grid` section type that accepts an array of child chart sections and renders them side-by-side in a CSS grid. Produces dashboard-quality layouts instead of stacked vertical charts.

**Files:**
- `src/lib/card-schema.ts`:
  ```ts
  export const ChartGridSection = z.object({
    type: z.literal('chart-grid'),
    columns: z.number().min(1).max(4).default(2),
    charts: z.array(z.union([ChartSection, VegaLiteSection])),
    caption: z.string().optional(),
  });
  ```
- `src/components/objects/AnalysisCard.tsx` — `ChartGridRenderer`:
  ```tsx
  <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${section.columns}, 1fr)` }}>
    {section.charts.map((c, i) => <ChartRenderer key={i} section={c} />)}
  </div>
  ```
- System prompt: example showing 2-column chart grid comparing two metrics.

**Key consideration:** Child `ChartSection` objects in a grid should be shorter than standalone charts (`height: 160` vs `height: 280`). Add a note in the system prompt.

---

### 4. Inline SVG / HTML Embed (`embed` section)

**What:** An `embed` section type that renders arbitrary HTML/SVG — flowcharts, org charts, timeline diagrams, custom gauges. The AI generates the HTML; the renderer sanitizes it.

**Files:**
- `src/lib/card-schema.ts`:
  ```ts
  export const EmbedSection = z.object({
    type: z.literal('embed'),
    html: z.string(),
    height: z.number().optional(),
    caption: z.string().optional(),
  });
  ```
- `src/components/objects/AnalysisCard.tsx` — `EmbedRenderer`:
  - Use `DOMPurify.sanitize(html, { USE_PROFILES: { svg: true, html: true } })`
  - Render into a `<div dangerouslySetInnerHTML>` inside a height-constrained container
  - **No iframes** — DOMPurify + inline rendering is sufficient and avoids same-origin complexity

**Security:** DOMPurify is already a dependency (used in `MarkdownRenderer`). The SVG profile allows `<svg>`, `<path>`, `<rect>`, `<circle>`, `<text>` but blocks `<script>`, `<iframe>`, event handlers.

**AI guidance:** System prompt example should show a simple SVG bar chart (so the AI understands the coordinate space) and a basic flowchart with `<rect>` + `<line>` + `<text>`.

---

## Phase 2 — Cognitive Upgrades

### 5. Proactive Alerts Engine

**What:** A background interval (separate from the existing 30s Sherpa scan) that monitors the active dataset against user-defined thresholds and surfaces `AmbientHint` alerts on relevant cards without user prompting.

**Architecture:**
- New file `src/lib/alert-monitor.ts` — pure function `checkAlertThresholds(dataset, thresholds)` returns `AlertFiring[]`. No AI call — pure data comparison.
- Thresholds stored in Supabase `user_memories` table (type: `'threshold'`) — reuse the existing memory system. The AI can create thresholds via a new `setThreshold` tool.
- New `setThreshold` tool in `src/lib/sherpa-tools.ts`:
  ```ts
  { name: 'setThreshold', params: { column, operator, value, label, severity } }
  ```
- `src/contexts/SherpaContext.tsx` — add a second interval (60s) that calls `checkAlertThresholds` and dispatches `ADD_SHERPA_OBSERVATION` for any firing thresholds.

**Key decision:** Thresholds are stored as memories (existing infrastructure), not a new DB table. This means the AI can create, recall, and modify them through the existing `rememberFact`/`recallMemories` tools until the `setThreshold` tool is built.

---

### 6. Multi-Dataset Fusion (JOIN across uploads)

**What:** Allow the AI to query across multiple uploaded documents simultaneously — e.g., JOIN AP aging against bank transactions on vendor name.

**Architecture:**
- `src/lib/active-dataset.ts` currently returns a single `{ columns, rows }`. Extend to `getDataset(documentId?)` — returns a specific document's parsed data.
- `src/lib/sherpa-tools.ts` — `queryDataset` tool gains an optional `documentId` param. If omitted, queries the active dataset (current behavior). If provided, queries a specific document.
- New tool `joinDatasets`:
  ```ts
  { name: 'joinDatasets', params: { leftDocumentId, rightDocumentId, leftKey, rightKey, columns } }
  ```
  Returns merged rows. Runs client-side as an in-memory hash join.
- `supabase/functions/ingest-document/index.ts` already stores parsed rows in Supabase. The `getDocument` function in `src/lib/document-store.ts` already fetches them.

**Effort is medium-high** because the data model (one active dataset) is baked into several places. The cleanest path is making `queryDataset` document-aware first, then adding `joinDatasets`.

---

### 7. Conversation Threading & Context Chains

**What:** Sherpa maintains a running thread — each query knows the outcome of the last, enabling compound reasoning like "Remember that vendor I flagged last week? Cross-check against the new bank statement."

**Current state:** `src/lib/conversation-memory.ts` already stores `{ query, response, timestamp }` pairs and injects the last N turns into the agent loop as message history. The infrastructure is mostly there.

**What's missing:**
- Outcome linkage — when an agent call creates a card, the conversation turn should record which card was created (`objectId`, `objectType`). Currently it only stores text.
- Cross-session persistence — conversation is in `localStorage`, lost on page reload.

**Files:**
- `src/lib/conversation-memory.ts` — add `outcomeCardIds?: string[]` to `ConversationTurn`. Populate from `AgentLoopResult.actions` in `useWorkspaceActions`.
- Supabase table `conversation_threads` (new migration) — persist turns server-side, keyed by `user_id`. Sync on session start.
- The agent prompt can then reference: "In a previous turn, you created card X which showed Y" — the structured history makes this factual.

---

### 8. Smart Card Linking

**What:** Clicking an entity name (vendor, person, date) in one card highlights all cards that contain the same entity.

**Architecture:**
- `src/lib/workspace-types.ts` — `WorkspaceObject.relationships` already exists as `string[]`. Extend to `{ type: 'entity-ref', entityName: string, entityType: string }[]`.
- New `src/lib/entity-extractor.ts` — scans card sections for entity names (vendor names, person names) and populates `relationships`. Run after each `createCard`/`updateCard`.
- `src/components/objects/AnalysisCard.tsx` — entity names rendered as `<button>` elements in table cells and narrative text (via `MarkdownRenderer` extension). On click: dispatch `HIGHLIGHT_ENTITY` action.
- `src/contexts/WorkspaceContext.tsx` — new `HIGHLIGHT_ENTITY` action sets `state.activeContext.highlightedEntity`. Object cards with a matching entity relationship get a visual ring.

**Hardest part:** Entity extraction from unstructured narrative text. Start with table cells (structured) — entity names are just column values. Narrative extraction can use a simple regex against known vendor names from the DataProfile.

---

## Phase 3 — Action & Automation

### 9. Email Draft Generator

**What:** One query ("Draft a follow-up to Delta Ducon about their $47K balance") → a formatted email rendered in a new `email-draft` card type with Copy and Send buttons.

**Files:**
- New card type `email-draft` in `src/lib/workspace-types.ts`.
- New renderer `src/components/objects/EmailDraft.tsx` — shows To/Subject/Body fields, Copy button, and a Send button (initially copies to clipboard; SMTP is a future enhancement).
- New agent tool `draftEmail` in `src/lib/sherpa-tools.ts`:
  ```ts
  { name: 'draftEmail', params: { to, subject, body, contextCardId? } }
  ```
  Returns `{ action: 'create', objectType: 'email-draft', ... }` — uses existing card creation path.
- The AI already has vendor names and balances in context. The tool just needs to trigger the right card type.

**No SMTP in v1** — the card is a draft surface. Send = copy to clipboard. Future: integrate with SendGrid or user's email client via `mailto:` deep link.

---

### 10. Workflow Automation Triggers

**What:** Persistent rules like "When Tier 1 balance > $50K, create an escalation card and notify me."

**Architecture:**
- New Supabase table `automation_triggers` — `{ id, user_id, condition: jsonb, action: jsonb, last_fired_at, enabled }`.
- New agent tool `createTrigger`:
  ```ts
  { name: 'createTrigger', params: { label, condition: { column, operator, value }, action: { type: 'createCard'|'notify', ... } } }
  ```
- `src/contexts/SherpaContext.tsx` — the existing 30s scan interval checks firing triggers against the current dataset and executes their actions via `dispatch`.
- Trigger actions reuse the existing `applyResult` pipeline — `createCard`, `focusCard` actions are already handled.

**This is medium complexity** — the condition evaluation reuses `src/lib/data-query.ts` filter logic which already handles operators. The main work is the Supabase table + the new tool.

---

### 11. Export & Report Builder

**What:** "Generate a PDF report of everything we've built today" → polished formatted document.

**Architecture — two options:**

**Option A (client-side, simpler):** `html2pdf.js` — captures the canvas DOM, converts to PDF. No server changes. Quality is limited (no page breaks, canvas elements don't print well).

**Option B (server-side, recommended):** New Supabase edge function `generate-report` that:
1. Receives a serialized workspace state (card titles, sections)
2. Renders an HTML template server-side
3. Uses Puppeteer (via a separate render service) or a headless Chrome layer to produce PDF
4. Returns a signed Supabase Storage URL

**Recommended path:** Start with Option A for a quick v1, then replace with Option B when quality matters.

**New tool** `exportWorkspace` in `src/lib/sherpa-tools.ts` — triggers the export flow.

---

### 12. Calendar & Deadline Integration

**What:** Sherpa reads payment deadlines from card data and creates calendar events.

**Architecture:**
- New agent tool `createCalendarEvent`:
  ```ts
  { name: 'createCalendarEvent', params: { title, date, description, url? } }
  ```
- Client-side: renders as an `.ics` file download (works with Apple Calendar, Google Calendar, Outlook — no OAuth required for v1).
- Future v2: Google Calendar API OAuth flow via Supabase Auth providers.

**Low-hanging fruit:** The `.ics` format is dead simple — 15 lines of text. v1 can be a download button with no external dependencies.

---

## Phase 4 — Full JARVIS Mode

### 13. Voice Interface

**Architecture:**
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) for input (no dependencies, works in Chrome/Edge).
- New hook `src/hooks/useVoiceInput.ts` — wraps `SpeechRecognition`, returns `transcript` + `isListening`.
- A microphone button in `src/components/workspace/SherpaRail.tsx` that feeds the transcript into `processIntent` — reuses the entire existing agent pipeline.
- Text-to-speech response: `window.speechSynthesis.speak()` reads Sherpa's text response aloud.
- **No external API needed for v1** — browser APIs only. ElevenLabs integration is an enhancement.

---

### 14. Image & Document Vision

**Architecture:**
- `supabase/functions/ingest-document/index.ts` already handles PDF and spreadsheet. Extend to accept image uploads.
- For images: call a vision model (GPT-4o Vision or Claude's image API) to extract structured data → returns JSON rows → treated as a new dataset.
- The existing `DocumentContext` and storage pipeline handle the rest unchanged.
- **Key addition:** `ai-image` edge function already exists — extend it to accept image + extraction prompt, return structured JSON rather than a generated image.

---

### 15. Multi-Agent Orchestration

**Architecture:**
- The existing `agentLoop` in `src/lib/sherpa-agent.ts` is single-threaded. Parallelism requires spawning multiple loops concurrently.
- New orchestrator function `orchestratorLoop` — reads the user's high-level intent, decomposes it into sub-tasks, dispatches each to a `workerLoop` instance, merges results.
- Sub-agents share the same `WorkspaceState` snapshot but write to isolated pending action queues that are merged after all complete.
- **Complexity is high** — primarily in conflict resolution when two workers try to create cards with overlapping data. Defer until Phases 1-3 are stable.

---

### 16. Predictive Modeling

**Architecture:**
- New card type `simulation` — shows a comparison of two scenarios side by side.
- New agent tool `runSimulation`:
  ```ts
  { name: 'runSimulation', params: { scenario_a: DataQuery, scenario_b: DataQuery, metric: string } }
  ```
- The tool runs both queries against the dataset client-side, computes the metric difference, returns structured results as a `chart-grid` section (two area charts side by side).
- No ML required for v1 — it's deterministic query execution with "what-if" semantics. The AI frames the narrative; the data does the math.

---

## Build Order Recommendation

```
Sprint 1 (Phase 1):  embed → chart-grid → vegalite → color themes
Sprint 2 (Phase 2):  proactive alerts → conversation threading → multi-dataset query
Sprint 3 (Phase 3):  email draft → export/PDF → calendar events → automation triggers
Sprint 4 (Phase 4):  voice → vision → multi-agent → simulation
```

Phase 1 items share a pattern (new section type → schema → renderer → prompt) so they compound well in a single sprint. Each one de-risks the next.
