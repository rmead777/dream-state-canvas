# Claude — Big Brother Initial Audit

**Project**: Dream-State Canvas
**Date**: 2026-03-28
**Auditor**: Claude Code (Opus 4.6)
**Method**: Parallel subagent review (4 specialized reviewers: Architecture, Security, Reliability/DX, Functionality)
**Codebase Size**: ~15,800 LOC across ~130 files

---

## Context

Dream-State Canvas is an **intent manifestation engine** — the AI IS the app. Users express intent via natural language, and the workspace materializes what they need as spatial objects that can be fused, inspected, and dissolved. This is NOT a dashboard with a chatbot bolted on.

**Development strategy**: Phase 1 (Lovable) sprinted the UI/UX forward with AI-native interaction patterns. Phase 2 (Claude Code) hardens the architecture and builds seriously. The codebase is 100% bot-authored (~330 commits from Lovable's gpt-engineer-app[bot]) — this is the strategy, not a red flag.

**Overall Grade: C+** — Functional but fragile. The domain model and interaction paradigm are solid. The security posture and engineering rigor are not.

---

## Dimension Scores

| Dimension          | Score | Assessment      | Top Issue                                            |
|--------------------|-------|-----------------|------------------------------------------------------|
| Architecture       | B-    | Solid bones     | Inverted lib/→hooks/ dependency, god hook & component |
| Security           | F     | Actively dangerous | All Edge Functions unauthenticated, public RLS/storage |
| Reliability        | C     | Fragile         | Silent error swallowing, no error boundaries, loose TS |
| Functionality      | B-    | Mostly works    | Admin overrides broken, ai-image orphaned, DOCX broken |
| DX/Maintainability | C-    | Hard to extend  | Zero tests, no docs, dual lockfiles, no CI            |

---

## Strengths — Preserve These

These are load-bearing walls of the intent manifestation engine. Build on them, don't rewrite them.

| Asset | File | Why It's Good |
|-------|------|---------------|
| Domain model | `src/lib/workspace-types.ts` | Clean types, discriminated union actions — extend this |
| Data transforms | `src/lib/data-slicer.ts` | Pure, deterministic, well-documented — gold standard |
| Thin orchestrator | `src/components/workspace/WorkspaceShell.tsx` | 87 LOC, delegates everything — keep it thin |
| Reducer actions | `src/contexts/WorkspaceContext.tsx` | Well-typed 21-action discriminated union |
| Provider nesting | `src/pages/Index.tsx` | WorkspaceProvider > SherpaProvider > DocumentProvider — correct order |
| AI fallbacks | `intent-engine.ts`, `data-analyzer.ts` | Every AI feature has deterministic fallback — preserve this pattern |
| Cross-object behavior | `src/hooks/useCrossObjectBehavior.ts` | Clean interface, correct useCallback deps |
| Ambient audio | `src/hooks/useAmbientAudio.ts` | Self-contained Web Audio API, proper refs |
| Object dispatch | `src/components/workspace/WorkspaceObject.tsx` | Clean type→component mapping, extensible |
| PDF viewer | `src/components/objects/PdfCanvasViewer.tsx` | Final PDF.js canvas approach is stable (iteration churn resolved) |

---

## All Findings

### CRITICAL (6)

#### CR-001 — Backend Is Fully Unauthenticated
- **Dimension**: Security
- **Location**: `supabase/config.toml` (all functions), `supabase/migrations/`
- **Detail**: `verify_jwt = false` on all 3 Edge Functions. Documents table RLS is `USING (true)`. Storage bucket is `public: true`. The `ingest-document` function uses the service role key with no caller validation. Anyone with the Supabase URL (visible in the frontend bundle) can read/write/delete all data, consume AI credits, and upload arbitrary files.
- **Fix**: Enable JWT verification on all functions. Add `user_id uuid REFERENCES auth.users(id)` to documents table. Replace `USING (true)` RLS with `auth.uid() = user_id`. Make storage bucket private, scope policies to `auth.uid()`. Restrict CORS from `*` to actual domain. Add auth header validation in each edge function handler.
- **Effort**: Medium (half-day, touches migrations + all 3 edge functions + client auth headers)

#### CR-002 — Zero Test Coverage
- **Dimension**: DX/Maintainability
- **Location**: `src/test/example.test.ts`
- **Detail**: The only test is `expect(true).toBe(true)`. Vitest and Testing Library are configured but unused. No safety net for regressions.
- **Fix**: Start with unit tests for pure functions: `data-slicer.ts`, `spatial-orchestrator.ts`, `fusion-rules.ts`, `cognitive-modes.ts`, intent-engine keyword fallback. These are high-value, low-effort targets.
- **Effort**: Low-Medium (a few hours for the pure function layer)

#### CR-003 — Inverted Dependency: lib/ Imports from hooks/
- **Dimension**: Architecture
- **Location**: `src/lib/intent-engine.ts:16`, `src/lib/data-analyzer.ts:1`, `src/lib/fusion-executor.ts:3`
- **Detail**: Three domain logic modules import `callAI` from `src/hooks/useAI.ts`. The `callAI` function is a standalone async function that doesn't use React APIs — it just happens to live in a hooks file. This inverts the dependency graph (lib/ should be the foundation hooks/ builds on), prevents independent testing of lib/, and creates a circular-dependency risk.
- **Fix**: Extract `callAI()` to `src/lib/ai-client.ts`. Update imports in intent-engine, data-analyzer, and fusion-executor.
- **Effort**: Low (30 minutes)

#### CR-004 — Service Role Key in Unauthenticated Edge Function
- **Dimension**: Security
- **Location**: `supabase/functions/ingest-document/index.ts:276-278`
- **Detail**: The ingest-document function creates a Supabase client with `SUPABASE_SERVICE_ROLE_KEY` (bypasses all RLS) but has `verify_jwt = false` — meaning unauthenticated requests reach the most privileged database client.
- **Fix**: After enabling JWT verification (CR-001), use the caller's JWT for user-scoped operations and restrict service role key usage to specific privileged operations.
- **Effort**: Included in CR-001 fix

#### CR-005 — Documents Table Has No user_id Column
- **Dimension**: Security
- **Location**: `supabase/migrations/20260328010526...sql`
- **Detail**: The documents table has no `user_id` column. Even if RLS were fixed, there's no column to scope policies against. All documents are globally shared.
- **Fix**: Add migration: `ALTER TABLE documents ADD COLUMN user_id uuid REFERENCES auth.users(id);` Then scope RLS policies.
- **Effort**: Included in CR-001 fix

#### CR-006 — Unvalidated Messages Array Passed to LLM
- **Dimension**: Security
- **Location**: `supabase/functions/ai-chat/index.ts:13,123`
- **Detail**: The `messages` array from the request body is spread directly into the LLM call with no validation. Attacker can inject `role: "system"` messages for prompt injection, send massive arrays for cost abuse, or send malformed data.
- **Fix**: Validate array structure, filter to only `user`/`assistant` roles, limit conversation length.
- **Effort**: Low (1 hour)

---

### HIGH (7)

#### HI-001 — SherpaRail God Component (567 LOC)
- **Dimension**: Architecture
- **Location**: `src/components/workspace/SherpaRail.tsx`
- **Detail**: Handles chat input, voice input, admin mode (passphrase unlock, model selection, token slider), document upload panel, document context selection, conversation history, canvas controls, suggestion chips, observation display, processing animation, and sign-out. 12 pieces of local state, 14 imports. Most fragile file in the codebase.
- **Fix**: Extract sub-components: `AdminPanel` (~lines 271-329), `ProcessingAnimation` (~lines 362-418), `ConversationHistory` (~lines 345-359), `CanvasControls` (~lines 524-563).
- **Effort**: Medium (3 hours, no behavior changes)

#### HI-002 — useWorkspaceActions God Hook (391 LOC)
- **Dimension**: Architecture
- **Location**: `src/hooks/useWorkspaceActions.ts`
- **Detail**: The `applyResult` function is a 296-line switch statement mixing AI calls, data slicing, state dispatch, and toasts. The `case 'update'` branch alone is 136 lines with nested async logic and inline function definitions. This is the heart of the intent→manifestation loop and its monolithic structure resists modification.
- **Fix**: Extract each action type handler into focused modules (e.g., `lib/actions/materialize.ts`, `lib/actions/update.ts`, `lib/actions/fuse.ts`). Keep the hook as thin dispatch.
- **Effort**: Medium (3 hours)

#### HI-003 — XSS via dangerouslySetInnerHTML (11 Sites)
- **Dimension**: Security
- **Location**: `src/components/objects/MarkdownRenderer.tsx:231-317`
- **Detail**: `applyInlineFormatting()` uses regex-based HTML injection rendered through `dangerouslySetInnerHTML` in 11 locations. No sanitization. Content comes from AI responses AND user-uploaded document data. With publicly writable documents (CR-001), attacker can inject XSS payloads.
- **Fix**: Install `dompurify`, wrap output: `return DOMPurify.sanitize(formatted)`.
- **Effort**: Low (1 hour, 1 file)

#### HI-004 — Hardcoded Admin Passphrase in Client Bundle
- **Dimension**: Security
- **Location**: `src/lib/admin-settings.ts:12`
- **Detail**: `const PASSPHRASE = 'protocol alpha'` is shipped in the production JS bundle. Anyone can activate admin mode via DevTools. Admin state persisted in localStorage.
- **Fix**: Remove client-side passphrase. Gate admin on a Supabase user role/claim verified server-side.
- **Effort**: Low-Medium (2 hours)

#### HI-005 — Wildcard CORS on All Edge Functions
- **Dimension**: Security
- **Location**: All 3 edge functions, lines 3-7
- **Detail**: `"Access-Control-Allow-Origin": "*"` on all functions. Combined with disabled JWT, any website can piggyback on AI API credits.
- **Fix**: Restrict to actual deployed domain.
- **Effort**: Low (included in CR-001)

#### HI-006 — ai-chat Ignores Admin Model/Token Overrides
- **Dimension**: Functionality
- **Location**: `supabase/functions/ai-chat/index.ts:115-127`
- **Detail**: Client sends `adminModel` and `adminMaxTokens` in request body (`useAI.ts:40-43`), but edge function hardcodes `model: "google/gemini-3-flash-preview"` and `max_tokens: 16192`. Admin panel UI appears functional but has zero effect.
- **Fix**: Read and apply admin overrides from request body (after adding proper admin role verification per HI-004).
- **Effort**: Low (after HI-004 is done)

#### HI-007 — No React Error Boundaries
- **Dimension**: Reliability
- **Location**: `src/App.tsx`
- **Detail**: No error boundaries anywhere. An uncaught throw in any component (AI response parsing, data rendering, PDF loading) = white screen for the entire app.
- **Fix**: Add error boundary at WorkspaceShell level (catches workspace errors) and around individual object renderers (isolates per-object failures).
- **Effort**: Low (1 hour)

---

### MEDIUM (14)

| ID | Finding | Location | Dimension |
|----|---------|----------|-----------|
| MD-001 | Duplicated fusion logic in 3 locations | `PanelCanvas.tsx`, `FreeformCanvas.tsx`, `useWorkspaceActions.ts` | Architecture |
| MD-002 | WorkspaceContext reducer is a monolith (21 actions, cross-cutting concerns) | `WorkspaceContext.tsx:32-256` | Architecture |
| MD-003 | `setActiveDocumentAsDataset` skips profile cache invalidation — switching datasets doesn't refresh AI profile | `DocumentContext.tsx:74-88` | Functionality |
| MD-004 | Document context dual-sync fragility (React state + module-level store must stay synchronized manually) | `DocumentContext.tsx:60-63`, `SherpaRail.tsx:63-76` | Reliability |
| MD-005 | `ingest-document` is a 533-LOC monolith (CSV, XLSX, PDF, image, text, dedup, DB insert) | `ingest-document/index.ts` | Architecture |
| MD-006 | DOCX ingestion effectively broken — binary file read as text produces garbage | `ingest-document/index.ts:455`, `document-store.ts:362` | Functionality |
| MD-007 | TypeScript strict mode disabled — `strict`, `strictNullChecks`, `noImplicitAny` all off | `tsconfig.json`, `tsconfig.app.json` | Reliability |
| MD-008 | `intent-engine.ts` does too much (369 LOC: AI parsing + keyword fallback + context building + data fetching + profile caching) | `intent-engine.ts` | Architecture |
| MD-009 | `document-store.ts` mixes CRUD + upload orchestration + text processing (465 LOC) | `document-store.ts` | Architecture |
| MD-010 | Type safety gap at Supabase boundary — `as unknown as DocumentRecord` casts hide null mismatches | `document-store.ts:418,431` | Reliability |
| MD-011 | Edge functions receive anon key, not user JWT — no per-user context even if RLS were fixed | `useAI.ts:49`, `document-store.ts:373` | Security |
| MD-012 | SherpaContext 30s observation interval resets during active use — `triggerObservationScan` callback recreated on every state change, tearing down and recreating the timer | `SherpaContext.tsx:28-50` | Reliability |
| MD-013 | No rate limiting on Edge Functions — cost abuse risk | All 3 edge functions | Security |
| MD-014 | `documentIds` sent to ai-chat but never read — document-contextual queries get no document grounding | `ai-chat/index.ts:13` | Functionality |

---

### LOW (12)

| ID | Finding | Location | Dimension |
|----|---------|----------|-----------|
| LO-001 | No code splitting — single route loads everything | `App.tsx` | Architecture |
| LO-002 | Dynamic CDN import for SheetJS (`https://cdn.sheetjs.com/xlsx-0.20.3/...`) — runtime CDN dependency, no tree-shaking | `document-store.ts:254` | Reliability |
| LO-003 | Module-level mutable state outside React tree (3 stores: `active-dataset.ts`, `admin-settings.ts`, `intent-engine.ts:21`) | Various | Architecture |
| LO-004 | `useCognitiveMode` reimplements logic already in `lib/cognitive-modes.ts` | `useCognitiveMode.ts:43-61` | DX |
| LO-005 | Workspace state only in localStorage — no server persistence, lost on clear | `useWorkspacePersistence.ts` | Reliability |
| LO-006 | `ai-image` edge function is completely orphaned — zero client callers | `ai-image/index.ts` | Functionality |
| LO-007 | `monitor` object type declared in types but no renderer exists — falls to "Unknown object type" | `workspace-types.ts:3` | Functionality |
| LO-008 | Dual lockfiles — both `bun.lock`/`bun.lockb` AND `package-lock.json` exist | Root | DX |
| LO-009 | README is a stub — `"TODO: Document your project here"` | `README.md` | DX |
| LO-010 | No `.env.example` — environment variables undocumented for collaborators | Root | DX |
| LO-011 | ~20 unused shadcn/ui components in `src/components/ui/` (calendar, carousel, input-otp, menubar, etc.) | `src/components/ui/` | DX |
| LO-012 | Object resize dimensions not persisted — card sizes reset on reload | `WorkspaceObject.tsx:49` | Functionality |

---

## Improvement Roadmap

### Layer 1 — Secure the Foundation (Don't Slow Down the Vision)

| # | ID | Task | Est. |
|---|----|------|------|
| 1 | CR-003 | Extract `callAI` to `src/lib/ai-client.ts` | 0.5h |
| 2 | HI-003 | Install `dompurify`, wrap MarkdownRenderer output | 1h |
| 3 | LO-008 | Delete `bun.lock`/`bun.lockb` — standardize on npm | 0.25h |
| 4 | LO-010 | Create `.env.example` from VITE_ vars | 0.25h |
| 5 | CR-006 | Validate + filter messages array in ai-chat | 1h |
| 6 | CR-001 | Enable JWT, add user_id, scope RLS + storage, restrict CORS | 6h |
| 7 | HI-007 | Add React error boundaries at WorkspaceShell and object levels | 1h |

### Layer 2 — Make the Core Thesis Extensible

| # | ID | Task | Est. |
|---|----|------|------|
| 1 | CR-002 | Unit tests for pure functions (data-slicer, spatial-orchestrator, fusion-rules, cognitive-modes) | 4h |
| 2 | HI-001 | Decompose SherpaRail into sub-components | 3h |
| 3 | HI-002 | Extract applyResult branches into focused action handlers | 3h |
| 4 | MD-001 | Extract duplicated fusion logic into shared `useFusion()` hook | 2h |
| 5 | HI-004 | Remove client-side passphrase, implement server-side admin role | 2h |

### Layer 3 — Push the Paradigm Forward

| # | ID | Task | Est. |
|---|----|------|------|
| 1 | MD-007 | Incrementally enable TypeScript strict mode (start with `strictNullChecks`) | 8h |
| 2 | MD-002 | Split WorkspaceContext into objects/sherpa/layout reducers | 6h |
| 3 | MD-005/008/009 | Decompose monolith modules (ingest-document, intent-engine, document-store) | 8h |
| 4 | — | Integration tests for intent → dispatch → render pipeline | 6h |
| 5 | — | CI setup (GitHub Actions: lint + type-check + test on push) | 2h |
| 6 | LO-005 | Server-side workspace persistence (Supabase table) | 8h |

### Backlog — Accept or Defer

| ID | Finding | Rationale |
|----|---------|-----------|
| LO-001 | No code splitting | ~16K LOC SPA — not worth complexity yet |
| LO-003 | Module-level mutable state | Works with single-mount architecture |
| LO-006 | Orphaned ai-image function | Can wire up when image features are needed |
| LO-011 | Unused shadcn components | Tree-shaking handles bundle; IDE noise is minor |
| LO-012 | Resize not persisted | Low user impact relative to effort |

---

## Essential Files Map

For any Claude Code instance working on this codebase, these are the files that matter most:

### Domain Core (understand these first)
- `src/lib/workspace-types.ts` — The entire domain model
- `src/contexts/WorkspaceContext.tsx` — Core state machine (useReducer, 21 action types)
- `src/hooks/useWorkspaceActions.ts` — Action orchestrator (god hook — refactoring target)
- `src/lib/intent-engine.ts` — NL query → structured actions (AI + keyword fallback)
- `src/lib/data-slicer.ts` — Pure data transforms (gold standard quality)
- `src/lib/data-analyzer.ts` — AI-powered dataset profiling

### UI Core
- `src/components/workspace/WorkspaceShell.tsx` — Top-level UI orchestrator (keep thin)
- `src/components/workspace/SherpaRail.tsx` — AI chat panel (god component — refactoring target)
- `src/components/workspace/PanelCanvas.tsx` — Drag-and-drop panel layout
- `src/components/workspace/WorkspaceObject.tsx` — Object renderer dispatch + card chrome

### AI Pipeline
- `src/hooks/useAI.ts` — Streaming/non-streaming AI client (contains misplaced `callAI`)
- `supabase/functions/ai-chat/index.ts` — Main AI gateway proxy with mode-specific system prompts
- `supabase/functions/ingest-document/index.ts` — Document ingestion pipeline (monolith)
- `src/lib/fusion-executor.ts` — AI-powered object synthesis

### State & Data
- `src/contexts/SherpaContext.tsx` — Proactive intelligence layer (observation scanning)
- `src/contexts/DocumentContext.tsx` — Document list + active dataset state
- `src/lib/document-store.ts` — Document CRUD + upload orchestration
- `src/hooks/useWorkspacePersistence.ts` — localStorage save/restore

---

## Coordination Notes

This audit serves as the shared reference for multiple Claude Code instances working on this codebase. When making changes:

1. **Finding IDs are stable** — Reference `CR-001`, `HI-003`, etc. in commit messages and discussions
2. **Check this file for context** before modifying any file listed in the Essential Files Map
3. **Preserve the strengths** listed above — they're the architectural foundation
4. **The intent→manifestation loop is sacred** — SherpaRail → useWorkspaceActions → intent-engine → WorkspaceContext → object renderers. Every change should make this loop better, not just different.
5. **Update this file** when findings are resolved — mark them with ✅ and the date
