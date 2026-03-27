

# Updated Plan: Meta-Rule Framework with Dataset Caching + Rename

## Two additions to the approved plan

### 1. Persist DataProfile per dataset (avoid re-analysis on reload)

Generate a fingerprint for each dataset (hash of column names + row count + first/last row values). Store the `DataProfile` keyed by this fingerprint in `localStorage` alongside the workspace state.

On load:
- Compute fingerprint of current dataset
- Check localStorage for a cached profile matching that fingerprint
- If found, use it immediately (no AI call)
- If not found, run the AI analysis, then cache the result

This means the same dataset never gets re-analyzed across reloads or sessions. A different dataset (new upload) gets a fresh analysis automatically since its fingerprint won't match.

**Implementation**: Add fingerprint + cache logic to `src/lib/data-analyzer.ts`:
```text
fingerprint = hash(columns + rowCount + rows[0] + rows[-1])
localStorage key: "dataset-profile-{fingerprint}"
```

### 2. Rename all "mock" references to "seed" or "canonical"

Since the data is real INCOA data, not mock:

- **Rename file**: `src/lib/mock-data.ts` → `src/lib/seed-data.ts`
- **Rename exports**:
  - `MOCK_LEVERAGE_DATA` → `SEED_LEVERAGE_DATA`
  - `MOCK_COMPARISON_DATA` → `SEED_COMPARISON_DATA`
  - `MOCK_ALERT_DATA` → `SEED_ALERT_DATA`
  - `MOCK_INSPECTOR_DATA` → `SEED_INSPECTOR_DATA`
  - `MOCK_BRIEF_DATA` → `SEED_BRIEF_DATA`
  - `MOCK_TIMELINE_DATA` → `SEED_TIMELINE_DATA`
  - `MOCK_DOCUMENT_DATA` → `SEED_DOCUMENT_DATA`
  - `MOCK_DATASET_DATA` → `CANONICAL_DATASET`
  - `DEFAULT_SUGGESTIONS` stays as-is
- **Update all imports** in `intent-engine.ts` and `sherpa-engine.ts`
- **Rename internal references**: `MOCK_DATA_BY_TYPE` → `SEED_DATA_BY_TYPE`, comments like "Mock data lookup" → "Seed data lookup"

Note: Once the data-slicer is built, `SEED_INSPECTOR_DATA`, `SEED_ALERT_DATA`, and `SEED_COMPARISON_DATA` get removed entirely (replaced by dynamic derivation from `CANONICAL_DATASET`). The remaining seed objects (leverage, brief, timeline, document) stay as narrative/aggregate seeds.

## Updated file list

- **Create** `src/lib/data-analyzer.ts` — DataProfile type, AI analysis, fingerprint-based localStorage caching, deterministic fallback
- **Create** `src/lib/data-slicer.ts` — pure derivation functions
- **Rename** `src/lib/mock-data.ts` → `src/lib/seed-data.ts` (update all export names)
- **Edit** `supabase/functions/ai-chat/index.ts` — add `analyze-schema` mode
- **Edit** `src/lib/intent-engine.ts` — use slicer + renamed imports
- **Edit** `src/lib/sherpa-engine.ts` — update import path
- **Edit** `src/components/objects/DataInspector.tsx` — previewCount, "N of M"
- **Edit** `src/components/objects/AlertRiskPanel.tsx` — derive from slicer

