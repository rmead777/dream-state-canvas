# Codebase Audit Report

**Project**: dream-state-canvas
**Date**: 2026-03-28
**Auditor**: Claude Code (Opus 4.6)
**Codebase Size**: ~15,700 LOC across 131 files (87 tsx, 42 ts, 2 css)
**Origin**: 329 commits from Lovable/gpt-engineer-app[bot], 0 human commits
**Overall Grade**: C-

---

## Project Philosophy (Critical Context)

This is an **intent manifestation engine**, not a conventional dashboard with AI bolted on. The AI IS the app — workspace objects materialize from user intent, not from pre-built UI. The Lovable-generated frontend was a deliberate strategy (Lovable excels at UI design iteration), and the codebase is now in Claude Code for serious engineering buildout.

**Implications for this audit:**
- Architecture patterns that look like "tight coupling" (AI in the data pipeline, unified state model) are often intentional design choices that serve the AI-native paradigm.
- The DataProfile + intent engine + spatial orchestrator chain is the core innovation — harden and extend, don't restructure.
- Security/reliability fixes are non-negotiable engineering. Architectural changes should deepen the AI-native pattern, not regress toward conventional dashboard architecture.

---

## Dimension Scores

| Dimension | Score | Assessment | Top Issue |
|-----------|-------|------------|-----------|
| Functionality | B- | Works on happy path | Keyword shadowing in intent engine; stale dataset ref |
| Reliability | D+ | Fragile | No error boundaries; 18+ silent catch blocks |
| Architecture | B- | Solid AI-native bones | God hook (300-line applyResult); could use pipeline refactor |
| Performance | C+ | OK at current scale | No table virtualization; context re-render cascade |
| Security | D | Dangerous | .env committed; XSS via dangerouslySetInnerHTML; open RLS |
| Testing | F | Non-existent | 1 placeholder test; 0% real coverage |
| DX/Maintainability | C- | Growing pains | strict: false; 31+ any usages; unused-vars lint disabled |

---

## Top 5 Priority Findings

### 1. [CR-001] .env with real Supabase credentials committed to git
- **Severity**: CRITICAL
- **Dimension**: Security
- **Location**: `.env` (tracked since commit 68f2498e)
- **Detail**: `.gitignore` has no `.env` entry. The file contains `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY` (a full JWT), and `VITE_SUPABASE_URL`. These are in git history permanently.
- **Impact**: Combined with wide-open RLS (CR-003), anyone with repo access has full CRUD on all documents.
- **Fix**: Add `.env` to `.gitignore`. Rotate the Supabase anon key. Purge git history with BFG or `git filter-branch`.
- **Effort**: Low (1-2 hours including key rotation)

### 2. [CR-002] XSS via unsanitized dangerouslySetInnerHTML in MarkdownRenderer
- **Severity**: CRITICAL
- **Dimension**: Security
- **Location**: `src/components/objects/MarkdownRenderer.tsx:231-317` (11 occurrences)
- **Detail**: `applyInlineFormatting()` converts raw text to HTML via regex, then injects it via `dangerouslySetInnerHTML`. No sanitization. AI-generated content flows directly through this path.
- **Impact**: If AI output contains `<script>` or `<img onerror=...>` (achievable via prompt injection on uploaded documents), arbitrary JS executes in the user's browser.
- **Fix**: Add `DOMPurify.sanitize()` wrapper around every `dangerouslySetInnerHTML` value.
- **Effort**: Low (30 minutes)

### 3. [CR-003] Documents table has wide-open RLS (USING (true))
- **Severity**: CRITICAL
- **Dimension**: Security
- **Location**: `supabase/migrations/` — documents table RLS policy
- **Detail**: RLS is enabled but the policy is `USING (true) WITH CHECK (true)` for ALL operations. The storage bucket is also public with no file type restrictions.
- **Impact**: Any anonymous user with the publishable key can read/write/delete ALL documents.
- **Fix**: Implement `USING (auth.uid() = user_id)`. Add `allowed_mime_types` to storage bucket. Set bucket to private.
- **Effort**: Medium (requires user_id population + migration)

### 4. [CR-004] No React error boundaries — any render error crashes entire app
- **Severity**: CRITICAL
- **Dimension**: Reliability
- **Location**: Entire app (zero ErrorBoundary components)
- **Detail**: The app heavily processes dynamic AI-generated JSON. A single malformed response causes a white screen. No recovery possible without page refresh.
- **Impact**: Especially dangerous for an intent manifestation engine where AI responses are unpredictable by design.
- **Fix**: Add top-level ErrorBoundary + per-WorkspaceObject boundaries (so one broken card doesn't kill the workspace).
- **Effort**: Low (2-3 hours)

### 5. [HI-001] Zero test coverage on complex AI-driven logic
- **Severity**: HIGH
- **Dimension**: Testing
- **Location**: `src/test/example.test.ts` — the only test is `expect(true).toBe(true)`
- **Detail**: 121 source files, 0 meaningful tests. The intent engine, data pipeline, workspace reducer, and markdown renderer are all untested.
- **Impact**: Every deployment is blind. Regressions are invisible.
- **Priority test targets**: intent-engine keyword matching, data-slicer transforms, workspace reducer actions, DataProfile caching logic.
- **Effort**: Medium (1-2 days for critical path coverage)

---

## All Findings by Category

### Security

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| CR-001 | CRITICAL | `.env` | Supabase credentials committed to git, .gitignore missing .env entry |
| CR-002 | CRITICAL | `MarkdownRenderer.tsx:231-317` | 11x unsanitized `dangerouslySetInnerHTML` on AI-generated content |
| CR-003 | CRITICAL | `supabase/migrations/` | Documents table RLS is `USING (true)` — fully open to anonymous access |
| HI-002 | HIGH | `admin-settings.ts:8` | Admin passphrase `'protocol alpha'` hardcoded in client-side JS |
| HI-003 | HIGH | `supabase/migrations/` | Storage bucket is public with no file type restriction (no `allowed_mime_types`) |
| ME-001 | MEDIUM | `useAI.ts:37-42` | Admin model/token overrides sent from client — edge function should validate server-side |
| ME-002 | MEDIUM | `document-store.ts` | No client-side file size validation before upload (server enforces 20MB but no early feedback) |
| LO-001 | LOW | `vite.config.ts` | Dev server binds to `::` (all interfaces) — exposes on local network |

### Reliability

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| CR-004 | CRITICAL | Entire app | No React error boundaries anywhere |
| HI-004 | HIGH | 18+ locations | Empty/silent catch blocks — errors swallowed with zero diagnostic signal |
| HI-005 | HIGH | `useWorkspaceActions.ts:170` | `profile!` non-null assertion on nullable `getCurrentProfile()` return |
| HI-006 | HIGH | `useAuth.ts:10-24` | Race condition between `onAuthStateChange` and `getSession` — session can flicker |
| HI-007 | HIGH | `useWorkspaceActions.ts:15-17` | Module-level mutable state (`_documentIdsRef`, `objectCounter`) outside React lifecycle |
| HI-008 | HIGH | `useAI.ts:149-207` | `callAI()` has no timeout or AbortController — server hang = infinite spinner |
| ME-003 | MEDIUM | `useWorkspaceActions.ts:36-39` | Silent error swallowing — if AI intent parsing AND keyword fallback both fail, no error shown |
| ME-004 | MEDIUM | `useWorkspacePersistence.ts:56-68` | Debounced save (1s) can lose data on tab close — no `beforeunload` handler |
| ME-005 | MEDIUM | `SherpaContext.tsx:57-63` | Missing `triggerObservationScan` in useEffect dependency array — stale closure |
| ME-006 | MEDIUM | `SherpaContext.tsx:66-69` | Suggestion useEffect depends only on `objectCount`, misses same-count object changes |
| ME-007 | MEDIUM | `useAI.ts:72-101` | Stream reader infinite retry on malformed JSON — no retry cap |
| ME-008 | MEDIUM | `useVoiceInput.ts:58` | AudioContext never closed — leaks on repeated voice interactions |
| LO-002 | LOW | `SherpaRail.tsx:41` | Prompt history grows unbounded in memory |
| LO-003 | LOW | `useAI.ts:68-101` | No reconnection logic on stream interruption — partial data returned as complete |
| LO-004 | LOW | `useWorkspacePersistence.ts:52` | Corrupt localStorage silently ignored — user loses saved workspace with no notification |

### Architecture

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| HI-009 | HIGH | `useWorkspaceActions.ts:46-342` | 300-line `applyResult` function mixing AI calls, data filtering, state dispatch, toasts. Should be refactored as a pipeline (parse → resolve → materialize → observe), not conventional CRUD handlers. |
| HI-010 | HIGH | `seed-data.ts` | 399 lines with 191 real vendor rows — names (Holly Johnson, Don Pulford), emails, dollar amounts shipped in production bundle. Real PII concern. |
| HI-011 | HIGH | `intent-engine.ts:77` | `SEED_DATA_BY_TYPE.dataset` captures `getActiveDataset()` at module load time — stale after dataset change |
| ME-009 | MEDIUM | `intent-engine.ts:352-356` | First-match-wins keyword matching causes shadowing — "risk" triggers alert before "risk assessment" triggers brief |
| ME-010 | MEDIUM | `intent-engine.ts:130-196` | `parseIntentAI` mixes AI orchestration with data fetching — can't test intent parsing without mocking data pipeline |
| ME-011 | MEDIUM | `fusion-executor.ts:33-34` | Context truncated via `.slice(0, 1200)` with no structural awareness — sends broken JSON to AI |
| ME-012 | MEDIUM | `FreeformCanvas.tsx` + `PanelCanvas.tsx` | Fusion execution logic (~50 lines) duplicated across both canvases |
| ME-013 | MEDIUM | `data-analyzer.ts:61-64` | Fingerprint only hashes first/last rows — datasets differing in middle rows collide |
| LO-005 | LOW | `data-slicer.ts` | Header claims "pure, deterministic" but `alertRows` and `metricAggregate` call `Date.now()` |
| LO-006 | LOW | `WorkspaceObject.tsx:30-42` | Missing `monitor` type renderer (8 of 9 types handled, has default fallback) |
| LO-007 | LOW | `WorkspaceContext.tsx:265-272` | Context value recreated every render — all consumers re-render on any state change |
| LO-008 | LOW | `fusion-rules.ts` | Only 2 blocked pairs — permissive default may produce meaningless fusions as types grow |

**Architecture note**: The monolithic WorkspaceContext and the AI-in-the-pipeline coupling are **intentional for the AI-native paradigm**. The Sherpa observes objects, objects relate to each other, intent creates objects referencing other objects — a unified state model serves this. Optimize within it (memoization, selectors) rather than splitting into domain-specific contexts.

### Performance

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| HI-012 | HIGH | `DatasetView.tsx:208-229` | All rows rendered as DOM elements — no virtualization. 191 rows × 7 cols = ~1400 DOM nodes. Won't scale. |
| HI-013 | HIGH | `WorkspaceContext.tsx` | Every state change (even TOUCH_OBJECT timestamp) triggers re-render for all consumers |
| ME-014 | MEDIUM | `SherpaContext.tsx:40-63` | 30-second interval resets on every render due to `triggerObservationScan` dependency — effectively never fires |
| ME-015 | MEDIUM | `useWorkspaceActions.ts:175-182` | Full dataset rows stored in object.context, copied on every state update via spread |
| ME-016 | MEDIUM | `FreeformCanvas.tsx:289-317` | Position dispatch on every mousemove during drag — 60 dispatches/sec |
| ME-017 | MEDIUM | `package.json` | 26 Radix UI packages imported — many likely unused. `recharts` (~200KB) used in 1 file. |
| LO-009 | LOW | `spatial-orchestrator.ts` | `computeLayout` called in 8 reducer actions — currently fast but won't scale past ~50 objects |

### Testing

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| HI-001 | HIGH | `src/test/` | 1 placeholder test (`expect(true).toBe(true)`). 0% real coverage. |
| HI-014 | HIGH | `playwright.config.ts` | E2E framework scaffolded but zero test files — hollow setup |
| LO-010 | LOW | — | Test-to-source ratio: 0.008 (1/121) |

### DX / Maintainability

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| HI-015 | HIGH | `tsconfig.app.json` | `strict: false`, `strictNullChecks: false`, `noImplicitAny: false` — TypeScript provides almost no type safety |
| HI-016 | HIGH | `eslint.config.js:23` | `@typescript-eslint/no-unused-vars` turned off — dead code accumulates silently |
| ME-018 | MEDIUM | 11+ files | 31+ instances of `: any` and `as any` — escape hatches from type safety |
| ME-019 | MEDIUM | `supabase/client.ts:1` | "Do not edit" comment but no enforcement mechanism for generated files |
| LO-011 | LOW | — | Import patterns and hook naming are consistent — positive finding |

---

## Improvement Roadmap

### Week 1: Harden the Core (High Impact, Low Effort)
These protect the AI-native experience from breaking when the AI does something unexpected.

1. **CR-001**: Add `.env` to `.gitignore`, rotate Supabase keys — *1 hour*
2. **CR-002**: Add DOMPurify to MarkdownRenderer — *30 min*
3. **CR-004**: Add ErrorBoundary (top-level + per-WorkspaceObject) — *2 hours*
4. **HI-004**: Add `console.error` to all empty catch blocks — *1 hour*
5. **HI-008**: Add 30-second AbortController timeout to `callAI()` — *30 min*
6. **HI-005**: Replace `profile!` with null guard — *15 min*
7. **HI-011**: Make `SEED_DATA_BY_TYPE.dataset` lazy — *30 min*

### Sprint 1: Deepen the Foundation (High Impact, Medium Effort)
Lock in the AI-native patterns with tests and type safety.

1. **CR-003**: Implement user-scoped RLS + private storage bucket — *4 hours*
2. **HI-003**: Add `allowed_mime_types` to storage bucket — *1 hour*
3. **HI-001**: Unit tests for intent-engine, data-slicer, workspace reducer — *1-2 days*
4. **HI-015**: Enable `strictNullChecks: true`, fix errors — *1 day*
5. **ME-004**: Add `beforeunload` save handler — *30 min*
6. **ME-009**: Fix keyword shadowing (scoring or phrase matching) — *2 hours*

### Quarter 1: Scale and Refine
1. **HI-009**: Refactor `applyResult` as a pipeline (parse → resolve → materialize → observe) — *1 day*
2. **HI-012**: Add row virtualization to DatasetView — *4 hours*
3. **HI-013**: Memoize context value + add selectors (stay unified, optimize access) — *1 day*
4. **HI-010**: Anonymize seed data (remove real PII) — *2 hours*
5. **HI-016**: Re-enable unused-vars lint, clean dead code — *half day*
6. Set up CI (GitHub Actions: lint + type-check + test) — *half day*
7. **ME-012**: Extract shared `useFusion()` hook from both canvases — *2 hours*

### Backlog: Accept or Defer
- SherpaContext interval effectively never fires (resets on every render) — ME-014
- AudioContext leak on voice input — ME-008
- Fingerprint collision risk in data-analyzer — ME-013
- Missing `monitor` type renderer — LO-006
- Drag dispatch throttling — ME-016
- `cognitive-modes.ts`, `smart-columns.ts`, `useCrossObjectBehavior.ts` — clean, no action needed

---

## Findings Count Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 4 |
| HIGH | 16 |
| MEDIUM | 19 |
| LOW | 11 |
| **Total** | **50** |
