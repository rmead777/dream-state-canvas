# PLAN: Ingest Document Upgrade — Claude Haiku + Admin Model Selection

**Session**: War Mode, 2026-04-09
**Status**: PLANNING — awaiting approval before code changes

---

## What We're Building

Replace the hardcoded Gemini Flash call in `ingest-document` with the existing `provider-router`, defaulting to Claude Haiku 4.5 via the Claude Code OAuth subscription (zero marginal cost). Make the model admin-configurable. Bypass AI extraction entirely for plain text files.

**The north star**: Upload a 50-page meeting transcript (PDF or TXT) and have Sherpa answer detailed questions about content on page 48, not just the first 3 minutes.

---

## The Current Problem (Root Cause Analysis)

### Bottleneck #1: Hardcoded 8K output cap
`ingest-document/index.ts:221` hardcodes `max_tokens: 8192` on a direct Gemini call. Every document — PDF, image, TXT — gets squeezed through an AI extraction step that can only emit ~6K tokens of useful content after JSON overhead.

### Bottleneck #2: TXT files unnecessarily AI-processed
Lines 577-593: TXT files are fed to `aiUnderstandDocument` which calls the capped AI endpoint. The raw text IS preserved (`extractedText = textContent`), but summary/keywords/insights come from the capped output. Since Sherpa's search relies on metadata, long TXT files appear "truncated" even though the raw content is in the database.

### Bottleneck #3: 500KB storage ceiling
Line 628: `extracted_text.slice(0, 500000)`. Fine for ordinary docs, but capped for long transcripts. Should be 5MB.

### The irony
The app already has `_shared/provider-router.ts` supporting:
- Claude via `CLAUDE_CODE_OAUTH_TOKEN` (your subscription, $0 per token)
- Claude via `ANTHROPIC_API_KEY` fallback
- Google Gemini, OpenAI, xAI
- Proper vision content translation (OpenAI `image_url` → Anthropic `image` source)

`ai-chat` already uses it with `adminModel` override and `maxTokens` up to 16K. `ingest-document` is the only AI-calling function still on the old hardcoded path.

---

## Files Changed

### Modified
1. **`supabase/functions/_shared/provider-router.ts`**
   - Extend `toAnthropicContent()` to detect `application/pdf` media type and emit `{type: 'document', source: {...}}` instead of `{type: 'image', source: {...}}`.
   - Add new `anthropic-beta` header for PDFs: `pdfs-2024-09-25` (required for native PDF support on Claude).
   - Backwards compatible: existing image handling unchanged.

2. **`supabase/functions/ingest-document/index.ts`**
   - Replace hardcoded `fetch("https://ai.gateway.lovable.dev/...")` in `aiUnderstandDocument` with `routeToProvider` from `provider-router`.
   - Accept `ingestModel` and `ingestMaxTokens` from request body; fall back to `'anthropic/claude-haiku-4-5-20251001'` and `32000`.
   - Skip `aiUnderstandDocument` call entirely for TXT/MD/DOCX files. Replace with lightweight summary-only call on first 8K chars.
   - Raise storage cap from 500KB → 5MB.
   - Non-streaming mode (`stream: false`) — ingestion doesn't need SSE.

### New
3. **`src/lib/ingest-settings.ts`** — NEW
   - LocalStorage-backed settings (same pattern as `threed-settings.ts`, `shader-settings.ts`).
   - `IngestSettings`: `{ model: string; maxTokens: number; bypassAiForText: boolean }`.
   - Default: `{ model: 'anthropic/claude-haiku-4-5-20251001', maxTokens: 32000, bypassAiForText: true }`.
   - Built-in model presets list for the dropdown.

4. **`src/components/workspace/IngestControlPanel.tsx`** — NEW
   - Admin panel component. Dropdown for model, slider for maxTokens (4K-64K), toggle for bypass-text.
   - Matches visual pattern of `ThreeDControlPanel.tsx` and `ShaderControlPanel.tsx`.

### Wire-up
5. **Existing document upload caller(s)** — locate in `src/` and pass `getIngestSettings()` values to the edge function request body.
6. **Admin tab wiring** — add `<IngestControlPanel />` to the admin tab (same place as `ThreeDControlPanel`).

---

## Acceptance Tests

### Functional
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] `npm run test` passes (all existing)
- [ ] Upload a >10-page PDF → Sherpa can answer questions about content on the last page (requires manual deploy + test)
- [ ] Upload a long TXT transcript → no AI call made for extraction, only lightweight summary call; full text queryable
- [ ] Switch model in admin panel → next upload uses the new model (verify via edge function logs)
- [ ] Upload with Haiku selected → verify log line `[anthropic] model=claude-haiku-4-5-20251001 auth=oauth`

### Non-functional
- [ ] Existing documents unaffected (no migration needed)
- [ ] `ai-chat` still works (provider-router change is backwards compatible)
- [ ] Default still works if admin hasn't changed anything (Haiku is the default)
- [ ] Fallback behavior: if Anthropic fails, clear error (not silent fallback to Gemini)

---

## Blast Radius

| Surface | Risk | Mitigation |
|---|---|---|
| All document uploads | HIGH — ingest-document is the single upload entry point | Keep the fallback path working; test with multiple doc types before shipping |
| `ai-chat` (Sherpa chat) | MEDIUM — shares `provider-router.ts` | PDF detection is MIME-type-gated; text-only messages unaffected. Both functions need redeploy. |
| Admin panel | LOW — new tab, no existing code changed | — |
| LocalStorage settings | LOW — new keys, doesn't touch existing | — |
| Database schema | NONE | No migration required |

### Deployment Required
- **Redeploy `ingest-document`** — contains the core changes
- **Redeploy `ai-chat`** — bundles the updated `_shared/provider-router.ts`
- **No DB migration**

### Env Var Check
- `CLAUDE_CODE_OAUTH_TOKEN` must be set in Supabase edge function secrets (already is — `ai-chat` uses it successfully)
- Confirm before merging by checking `ai-chat` logs for `[anthropic] auth=oauth` lines

---

## Implementation Order

Commits in this order so each is reviewable and reversible:

1. **Commit 1**: `provider-router.ts` — add PDF document-type translation for Anthropic. No behavior change for existing callers.
2. **Commit 2**: `ingest-settings.ts` — new settings file (no consumers yet).
3. **Commit 3**: `IngestControlPanel.tsx` + admin tab wire-up — new UI, doesn't affect upload flow yet.
4. **Commit 4**: `ingest-document/index.ts` — switch to provider-router, default Haiku, raise limits, text bypass.
5. **Commit 5**: Update document upload caller(s) to pass settings from `getIngestSettings()`.
6. **Commit 6** (if needed): Fix any bugs discovered during acceptance testing.

**Checkpoint cadence**: commit after each of 1-5. Run `tsc --noEmit` between each.

---

## Things I Considered And Rejected

### Rejected: Extend provider-router with a new `documentInput` parameter
Too invasive. The existing `image_url` content type already carries enough info (base64 data URI + mime type) to distinguish PDFs from images. Translation happens inside `toAnthropicContent` where the logic belongs.

### Rejected: Chunked PDF extraction (split by pages, parallel AI calls)
Overkill for Haiku's 200K input + 64K output window. A 100-page PDF fits comfortably. Revisit only if we hit a doc that exceeds Haiku's window.

### Rejected: Server-side PDF text extraction (pdf-parse, pdfjs)
Loses layout awareness. Claude's native PDF handling is better than text extraction for meeting transcripts because it preserves speaker attribution, timestamps, and tabular content.

### Rejected: Non-admin settings sync (Supabase table)
LocalStorage is fine for this internal single-user tool. Matches existing pattern. Avoids migration.

---

## Open Questions For Ryan

1. **Default model**: Haiku 4.5 is my default choice (cheap, fast, 200K context, $0 on your subscription). Agree?
2. **Model dropdown options**: Propose Haiku 4.5, Sonnet 4.6, Opus 4.6, Gemini 3 Flash, Gemini 2.5 Pro. Anything to add/remove?
3. **BYPASS_AI_FOR_TEXT toggle**: Default ON (recommended). Users with special needs can turn it off. Agree?
4. **Max tokens range**: 4K min, 64K max, 32K default. Agree?
5. **Should I also add a "re-ingest existing document" button** to let you re-process old truncated uploads with the new model? (Not in scope for this PR but worth a follow-up.)

---

## Ready to execute when you say GO.
