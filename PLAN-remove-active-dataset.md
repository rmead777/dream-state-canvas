# PLAN: Remove Active Dataset Global Singleton

## Status: READY FOR BUILD LOOP

## The Problem

There is a global singleton called "active dataset" (`src/lib/active-dataset.ts`) that holds one document's data (columns + rows) as a privileged default. Every query, every card render, every export, and every AI tool call falls back to this singleton when no document is explicitly specified.

The vendor tracker (INCOA_AP_Vendor_Tracker_v14) becomes the active dataset on app load. After that, **every code path that forgets to specify a document ID silently gets the vendor tracker's data**. This causes:

- Scratchpads showing vendor tracker data instead of their own data
- AI analysis cards pulling from the wrong document
- Exports downloading the tracker instead of the card's actual data
- The wrong document being auto-selected after upload
- Confusion about which data the AI is actually looking at

**The core architectural flaw:** No document should be privileged. Every data access should explicitly reference a document by ID. The AI should infer which document to use from context (it already receives all document IDs and column names in its system prompt).

## Current Architecture (Broken)

### `src/lib/active-dataset.ts` — The Global Store
- `getActiveDataset()` — returns the singleton (vendor tracker)
- `setActiveDataset()` — sets it (called on app load + document upload)
- `getDataset(documentId)` — fetches a specific doc, falls back to active dataset on ANY failure
- `subscribeDataset()` — notifies listeners on change

### Where Active Dataset Gets Injected (8+ places)

| File | What It Does | Why It's Wrong |
|------|-------------|----------------|
| `DatasetView.tsx:34` | Renders card data — prefers active dataset over card's own data | Cards should use their own context |
| `ImmersiveOverlay.tsx:44-45` | Excel export — uses active dataset instead of card data | Export should export what you're looking at |
| `data-query.ts:28` | Query engine fallback when no `_dataset` provided | Should require explicit dataset |
| `sherpa-tools.ts:718,750,1110,1159,1369` | AI tool fallbacks | AI should always specify documentId |
| `action-handlers.ts:174,678` | Card update/refine handlers | Should use card's own data |
| `sherpa-agent.ts:86,543` | Agent context building | Should use document list, not singleton |
| `SherpaContext.tsx:85` | Next moves / suggestions | Should reference specific documents |
| `intent-engine.ts:22,39` | DataProfile cache | Should be per-document |
| `entity-extractor.ts:92` | Entity linking | Should reference specific documents |
| `automation-triggers.ts:184` | Trigger evaluation | Should reference specific documents |
| `useAIContext.ts:82` | AI context injection | Should use document list |
| `RulesEditor.tsx:16,22` | Rules UI | Should reference specific documents |
| `DocumentContext.tsx:66,125,135` | Sets the global on load/upload | This is the source of the problem |
| `useDocumentUpload.ts:24` | Sets global after upload | Same |
| `SherpaRail.tsx:16` | Imports setActiveDataset | Same |

### The Kill Chain (Why Scratchpads Show Tracker Data)

1. App loads → DocumentContext picks first spreadsheet → calls `setActiveDataset()` → vendor tracker is now the global default
2. AI creates scratchpad → `createScratchpad` tool stores doc in Supabase with its own columns/rows
3. Tool returns `action: 'create'` with `data: { columns, rows, sourceDocId }` (scratchpad's own data)
4. `handleCreate` sets `context = action.data` (correct)
5. `handleCreate` sees `action.dataQuery`, calls `executeDataQuery` → **overwrites context.columns/rows** with query result
6. `executeDataQuery` calls `getActiveDataset()` as fallback → vendor tracker data
7. Even if step 5-6 are fixed, `DatasetView` calls `getActiveDataset()` and prefers it when it has more columns
8. Even if step 7 is fixed, Excel export calls `getActiveDataset()` and prefers it

## The Solution

**Remove the concept entirely.** Every data access must explicitly reference a document by ID. No document gets special treatment.

### New Architecture

1. **Cards always contain their own data** in `context.columns` and `context.rows`. No fallback.
2. **AI tools require `documentId`** or return an error. The AI already sees all documents with IDs and columns in its system prompt.
3. **`executeDataQuery` requires `_dataset`** — no silent fallback.
4. **Renderers use card context only** — `DatasetView` and export use `object.context`, never a global store.
5. **`DocumentContext` tracks uploaded documents** but doesn't promote any as a global data source. It manages the UI list of documents, not a privileged default.

### What Stays
- `DocumentContext` still manages the list of uploaded documents and lets users select which ones the AI considers
- The seed data (`CANONICAL_DATASET`) still exists as demo data when no documents are uploaded
- `getDataset(documentId)` stays as a utility to fetch a specific document's data — but returns null on failure, never falls back

### What Gets Removed
- `getActiveDataset()` — the global singleton getter
- `setActiveDataset()` — the global singleton setter  
- `subscribeDataset()` — change notifications for the singleton
- Every call site that uses these functions
- The `preferLive` logic in DatasetView
- The active dataset fallback in `executeDataQuery`

## Implementation Plan

### Step 1: DatasetView — Use Card Data Only
**File:** `src/components/objects/DatasetView.tsx`
- Remove import of `getActiveDataset`
- Remove the `liveDs`, `hasOwnData`, `preferLive` logic (lines 33-44)
- `allColumns` = `d.columns || []`
- `sourceRows` = `d.rows || []`
- If a card has no data, it shows empty — that's a bug in card creation, not a rendering concern

### Step 2: ImmersiveOverlay — Export Card Data Only
**File:** `src/components/workspace/ImmersiveOverlay.tsx`
- Remove import of `getActiveDataset`
- In `handleExportExcel`: use `ctx.columns` and `ctx.rows` directly
- No fallback to any global store

### Step 3: executeDataQuery — Require Explicit Dataset
**File:** `src/lib/data-query.ts`
- Remove import of `getActiveDataset`
- Change `_dataset` from optional fallback to required
- If `_dataset` is not provided and no data in the query, throw an error
- This forces all callers to be explicit

### Step 4: Sherpa Tools — Always Resolve Document
**File:** `src/lib/sherpa-tools.ts`
- For `queryDataset`: if no `documentId`, use the first document from the documents list (query Supabase), not a global singleton. Or better: return an error telling the AI to specify one.
- For `searchData`: same — needs explicit document or fetch first available
- For `editDataset`: already has documentId handling, clean up fallback
- For `computeStats`: same
- For `getCardData`: uses card context, no change needed
- For `joinDatasets`: already takes explicit document IDs

### Step 5: Action Handlers — Use Card Context
**File:** `src/lib/action-handlers.ts`
- `handleUpdate`: when executing dataQuery, the card's own data or the resolved document should be used
- `handleRefineRules`: needs document context, not global dataset
- Remove import of `getActiveDataset`

### Step 6: Agent Context — Use Document List
**Files:** `src/lib/sherpa-agent.ts`, `src/contexts/SherpaContext.tsx`, `src/hooks/useAIContext.ts`
- The AI system prompt already includes document list with IDs + columns
- DataProfile generation should be per-document (keyed by document ID)
- Remove `getActiveDataset()` calls, use document list from `listDocuments()`

### Step 7: Supporting Files
**Files:** `src/lib/intent-engine.ts`, `src/lib/entity-extractor.ts`, `src/lib/automation-triggers.ts`, `src/components/workspace/RulesEditor.tsx`
- Each of these uses `getActiveDataset()` for DataProfile or entity matching
- Replace with document-specific lookups or pass data as parameters

### Step 8: DocumentContext — Stop Setting Global
**Files:** `src/contexts/DocumentContext.tsx`, `src/hooks/useDocumentUpload.ts`, `src/components/workspace/SherpaRail.tsx`
- Remove calls to `setActiveDataset()` / `setGlobalDataset()`
- DocumentContext still tracks which documents exist and which is "primary" for UI purposes
- But it doesn't push data into a global singleton

### Step 9: Clean Up active-dataset.ts
**File:** `src/lib/active-dataset.ts`
- Remove `getActiveDataset()`, `setActiveDataset()`, `subscribeDataset()`
- Keep `getDataset(documentId)` as a utility (it fetches from Supabase by ID)
- Rename file to `dataset-loader.ts` or similar to reflect its actual purpose

### Step 10: Tests
**Files:** `src/lib/__tests__/action-handlers.test.ts`, `src/lib/__tests__/sherpa-engine.test.ts`
- Update tests that call `setActiveDataset()` to pass data explicitly instead

## Risk Assessment

- **High risk:** `executeDataQuery` is called everywhere. Making `_dataset` required means every caller must be updated. Missing one = crash.
- **Medium risk:** `DatasetView` change is straightforward but affects every dataset card on the canvas.
- **Low risk:** Export and agent context changes are isolated.

## Build Order

Do steps 1-2 first (rendering) — these fix the visible bug immediately.
Then steps 3-4 (query engine + tools) — these prevent future data leaks.
Then steps 5-8 (supporting code) — cleanup.
Then step 9-10 (remove the file + tests).

**Test after each step:** open the app, create a scratchpad, verify it shows its own data. Open the tracker, verify it still works. Export both, verify correct data.

## Files Changed (Complete List)

1. `src/components/objects/DatasetView.tsx`
2. `src/components/workspace/ImmersiveOverlay.tsx`
3. `src/lib/data-query.ts`
4. `src/lib/sherpa-tools.ts`
5. `src/lib/action-handlers.ts`
6. `src/lib/sherpa-agent.ts`
7. `src/contexts/SherpaContext.tsx`
8. `src/hooks/useAIContext.ts`
9. `src/lib/intent-engine.ts`
10. `src/lib/entity-extractor.ts`
11. `src/lib/automation-triggers.ts`
12. `src/components/workspace/RulesEditor.tsx`
13. `src/contexts/DocumentContext.tsx`
14. `src/hooks/useDocumentUpload.ts`
15. `src/components/workspace/SherpaRail.tsx`
16. `src/hooks/useWorkspaceActions.ts`
17. `src/lib/active-dataset.ts` (rename to `dataset-loader.ts`)
18. `src/lib/__tests__/action-handlers.test.ts`
19. `src/lib/__tests__/sherpa-engine.test.ts`
