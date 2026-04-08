# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## SUPER DUPER IMPORTANT

### Always push to main
Push ALL changes to `main` immediately after committing. Do NOT ask for permission. Ryan does not need to approve pushes.

### Edge Function & Migration Deployment Alerts
Supabase edge functions and database migrations are NOT auto-deployed from git. When you change ANY file under `supabase/functions/` or create a new file under `supabase/migrations/`, you MUST tell Ryan explicitly using this format:

```
⚠️ DEPLOYMENT NEEDED:
- Edge functions changed: [list function names]
  → Action: Tell Lovable to redeploy edge functions, or run `supabase functions deploy [name]`
- New migration: [filename]
  → Action: Run this SQL in the Supabase Dashboard SQL Editor
```

If you forget this, the deployed code stays stale and nothing works. This has caused hours of debugging. DO NOT skip this step. EVER.

### AI-First, No Keyword Fallbacks
The AI is the primary AND fallback path. When AI fails, show an error message — never fall back to keyword/regex matching. Keyword matching cannot distinguish "show risks" from "stop showing risks."

### Design Philosophy
This is an **intent manifestation engine**, not a dashboard with AI. The AI IS the app. Objects materialize from user intent, not from pre-built UI. Every architectural decision should make the intent→manifestation loop better.

---

## Project Overview

Sherpa AI (formerly Dream State Canvas) is an AI-powered analytical workspace where users upload documents (spreadsheets, PDFs, etc.) and interact with them through natural language. The app materializes data as "workspace objects" — cards that appear, collapse, fuse together, and dissolve — on a spatial canvas. An AI assistant called "Sherpa" observes workspace state and proactively offers suggestions.

Originally scaffolded with Lovable.dev. Uses Supabase for backend (auth, database, storage, edge functions).

## Commands

```bash
npm run dev          # Vite dev server on port 8080
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Vitest (single run)
npm run test:watch   # Vitest (watch mode)
```

Tests live in `src/**/*.{test,spec}.{ts,tsx}`, use jsdom environment with globals enabled. Setup file: `src/test/setup.ts`.

## Architecture

### Stack
- **Frontend**: Vite + React 18 + TypeScript + Tailwind CSS + shadcn/ui (Radix primitives)
- **Backend**: Supabase (auth, Postgres, storage bucket, edge functions)
- **AI**: Supabase edge functions (`ai-chat`, `ai-image`, `ingest-document`) accessed via SSE streaming
- **Path alias**: `@/` maps to `src/`

### Core Data Flow

```
User query → SherpaRail (chat UI)
  → useWorkspaceActions.processIntent()
    → sherpa-agent.agentLoop() — multi-turn tool-using agent
      → Builds structured context via workspace-intelligence.ts
      → Calls AI with tool definitions (sherpa-tools.ts)
      → AI can call read tools (getCardData, queryDataset, searchData, etc.)
      → AI can call write tools (createCard, updateCard, dissolveCard, etc.)
      → Loops up to N iterations until AI has enough info to respond
      → Returns response + actions
    → Actions dispatched via applyResult → WorkspaceContext reducer
      → Objects materialize/focus/dissolve/update on canvas
```

**Note:** The old single-turn `parseIntentAI` pipeline was removed (March 2026).
The agent loop subsumes all intent parsing, tool calling, and action generation.
`intent-engine.ts` now only contains DataProfile cache management and rule refinement.

### Three Context Providers (nested in Index.tsx)

1. **WorkspaceContext** — `useReducer`-based state for all workspace objects, spatial layout, and Sherpa state. The reducer handles ~20 action types (MATERIALIZE_OBJECT, DISSOLVE_OBJECT, FOCUS_OBJECT, etc.). All layout recomputation goes through `computeLayout()` from `spatial-orchestrator.ts`.

2. **SherpaContext** — Intelligence layer that observes workspace state on a 30-second interval and when object count changes. Generates proactive suggestions and observations via `sherpa-engine.ts`. Reads from WorkspaceContext.

3. **DocumentContext** — Manages uploaded documents from Supabase. Tracks the "active dataset" (columns + rows) used by data-derived objects. Falls back to `CANONICAL_DATASET` from `seed-data.ts` when no documents are uploaded.

### Workspace Object System (`lib/workspace-types.ts`)

Objects have a lifecycle: `materializing → open → collapsed → dissolved`. Types include: `metric`, `comparison`, `alert`, `inspector`, `brief`, `timeline`, `monitor`, `document`, `document-viewer`, `dataset`, `analysis`, `action-queue`, `vendor-dossier`, `cash-planner`, `escalation-tracker`, `outreach-tracker`, `production-risk`. Each type has a corresponding renderer in `components/objects/`.

Objects are placed in spatial zones (`primary`, `secondary`, `peripheral`) by `spatial-orchestrator.ts` with a hard cap of 2 primary + 2 secondary visible objects.

### AI Integration

- `hooks/useAI.ts` — exposes `useAI()` (streaming hook) and `callAI()` (non-streaming). Both call the Supabase `ai-chat` edge function at `VITE_SUPABASE_URL/functions/v1/ai-chat`. Streams use SSE with OpenAI-compatible `data:` lines.
- `lib/sherpa-agent.ts` — Multi-turn tool-using agent loop. The primary AI pipeline. Calls AI with tool definitions, executes tools client-side, loops until the AI has enough context to respond. Returns response + workspace actions. Includes context hint blocks for QuickBooks, Ragic, email, scratchpads, and editing.
- `lib/sherpa-tools.ts` — Tool definitions (OpenAI function-calling format) and client-side executors:
  - **Read tools**: getCardData, queryDataset, searchData, getWorkspaceState, getDocumentContent, computeStats, joinDatasets
  - **Write tools**: createCard, updateCard, dissolveCard, focusCard, editDataset, createScratchpad
  - **Memory tools**: rememberFact, recallMemories, consolidateMemories
  - **QuickBooks tools**: queryQuickBooks, refreshQuickBooks
  - **Ragic tools**: queryRagicOrders, queryRagicCustomers, syncRagic
  - **Email tools**: queryEmails, refreshEmails
  - **Other**: draftEmail, createCalendarEvent, exportWorkspace, runSimulation, suggestNextMoves
- `lib/data-analyzer.ts` — `DataProfile` is an AI-generated schema analysis (domain, key columns, sort rules, display columns). Cached in localStorage with version key.
- `lib/data-slicer.ts` — Pure deterministic functions that derive preview subsets using the DataProfile.
- `lib/fusion-executor.ts` — AI-synthesizes two workspace objects into a new "brief" object.

### External Data Integrations

All follow the same pattern: edge function → Supabase cache → client-side store → Sherpa tools.

- **QuickBooks** (`lib/quickbooks-store.ts`) — Live QB data via `qbo-data` edge function. Session cache (45-min TTL). Reads token from WCW's Supabase. Data types: ap, ar, bank, pnl, vendors, customers, bill_payments, summary.
- **Ragic CRM** (`lib/ragic-store.ts`) — Sales orders + customer profiles synced from Ragic API. Edge functions: `ragic-fetch-orders`, `ragic-sync-customers`, `ragic-status`. Cached in Supabase tables (`ragic_orders_cache`, `customer_profiles`, `customer_product_prices`). Connection config in `ragic_connections` table.
- **Outlook Email** (`lib/email-store.ts`) — MSAL client-side auth, Graph API sync to Supabase `ap_emails` table. **LOCKED to a single designated folder** — `enforceAllowedFolder()` blocks access to any other folder. Folder change requires super admin passphrase.
- **Status Panels** — `QBOStatusPanel.tsx`, `RagicStatusPanel.tsx`, `OutlookStatusPanel.tsx` in the Context tab.

### Visualization System

Cards render structured sections via `AnalysisCard.tsx` → `SectionRenderer`. Section types:
- **Text**: summary, narrative, callout, metrics-row
- **Data**: table (with conditional highlights), metric
- **2D Charts** (`ChartRenderer`): bar, line, area, pie, donut, scatter, radialBar, funnel, treemap, composed. Frosted glass palette (25% fill opacity + full-opacity borders). Themes in `lib/chart-themes.ts`.
- **Vega-Lite**: heatmap, boxplot, waterfall, histogram, violin, etc.
- **3D** (`ThreeDRenderer.tsx`, lazy-loaded): bar3d, scatter3d, pie3d, network, surface + animated: barRace, radialBurst, connectionMap, particleFlow, timelineFlow. 30+ configurable props per scene. Uses React Three Fiber + Drei.
- **Animated Metrics** (`AnimatedMetricsRenderer.tsx`): CSS+RAF counter dashboard with counting numbers.
- **Embed**: DOMPurify-sanitized SVG/HTML.

**Styling control**: AI can pass `style: { css }` on any section. Metrics/animated-metrics accept labelSize, valueSize, labelColor, valueColor, backgroundColor, etc. 3D scenes accept camera, lighting, material, animation props. The AI has FULL control over visual appearance — do NOT hardcode styles that prevent AI overrides.

### WebGL Shader Background

`BackgroundShader.tsx` — ping-pong FBO simplex noise flow field. 14 tunable parameters via `ShaderControlPanel.tsx` in admin tab. Settings in `lib/shader-settings.ts` (localStorage-backed). 30fps, tab-pause, prefers-reduced-motion.

### Key Hooks

- `useWorkspaceActions` — Orchestrates intent processing, object CRUD, fusion execution, and data rule refinement. The main action dispatcher. Status updates go to `SET_SHERPA_STATUS` (separate from `SET_SHERPA_RESPONSE` to prevent chat text from disappearing).
- `useWorkspacePersistence` — Saves/restores workspace state to localStorage.
- `useCognitiveMode` — Tracks user engagement patterns.
- `useWorkspaceBreathing` — Monitors object density, triggers over-capacity warnings.
- `useAnimationTimeline` — Shared animation utilities (easing, stagger, reduced-motion).

### Tailwind Design Tokens

Custom `workspace-*` color tokens defined in `tailwind.config.ts` and set via CSS variables: `workspace-bg`, `workspace-surface`, `workspace-accent`, `workspace-text`, `workspace-text-secondary`, `workspace-border`.

### Supabase Edge Functions

Located in `supabase/functions/`:
- `ai-chat` — Main AI endpoint. Contains the system prompt that defines ALL of Sherpa's capabilities.
- `ai-image` — Image generation
- `ingest-document` — Document upload processing (spreadsheet parsing, PDF extraction, AI analysis)
- `qbo-data` — QuickBooks data fetching (reads token from WCW Supabase)
- `qbo-status` — QuickBooks connection health check
- `ragic-fetch-orders` — Ragic order sync with field aliasing, weight/price resolution, customer mapping
- `ragic-sync-customers` — Ragic customer profile sync
- `ragic-status` — Ragic connection status (DB-only, no API call)
- `generate-report` — PDF report generation
- `_shared/qbo-client.ts` — QB OAuth token management + API wrapper
- `_shared/ragic-utils.ts` — Ragic API utilities (retry, auth, record extraction)
- `_shared/sync-utils.ts` — Batch upsert + payment terms parsing

### Environment Variables

Configured via `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (loaded through Vite's `import.meta.env`).

### User Authentication & Profile

- Supabase auth (email/password + Google OAuth)
- User profile pill in top-right corner shows name/avatar + sign out dropdown
- `MobileShell.tsx` — completely separate component tree for mobile (early return pattern)
- Sherpa memories (`sherpa_memories` table) are per-user (RLS enforced)
- Documents are per-user (RLS enforced)
- Ragic/QB data is shared (global, not user-scoped) — internal tool for same company

## AI-Native Architecture Principle: Permissive Execution, Not Rigid Validation

**This is a canonical rule for this codebase. It overrides standard "validate strictly" engineering practices.**

In AI-native systems, the AI is the intelligence layer. Adding rigid validation (Zod schemas, strict type checks, keyword matching) between the AI's output and the executor creates a dumber system gatekeeping a smarter one. Every rigid boundary is a place where a reasonable AI output gets silently rejected.

### The Rule

**The executor is the safety net. The validator is the wall. Keep the safety net. Remove the wall.**

- Unknown operator in a query? Executor defaults to "contains". Don't reject it at the schema level.
- AI returns an action field you didn't anticipate? Executor ignores it gracefully. Don't crash.
- AI invents a reasonable filter structure? Executor handles what it can. Don't Zod-reject the whole response.

### What This Means In Practice

1. **Do NOT add Zod validation to AI output** unless the field is required for routing (e.g., action type). Validate structure minimally, never validate content strictly.
2. **Do NOT add keyword matching fallbacks.** Keyword matching cannot understand negation or context. "Stop showing risks" matches "risk" and creates a risk panel. This is worse than doing nothing. If the AI is unavailable, show an explicit catalog of options.
3. **Do NOT add security/validation layers that break functionality.** Test every validation layer with the question: "does this make the product work better, or does it just make it fail differently?" If the latter, remove it.
4. **Every executor must have graceful fallbacks for unexpected input.** `default: return true` for unknown operators. Sensible defaults for missing fields. Extract what you can, ignore what you can't.

### Evidence From This Codebase

These "safety" layers all made the product worse:
- Zod intent validation → rejected valid AI responses → silent failures
- RLS policies → broke document uploads → feature stopped working  
- JWT verification → broke edge functions → nothing worked
- Keyword fallback → matched wrong intent → did the opposite of what user wanted

The product worked better before every one of these was added. Safety layers that break functionality are not safe.

### The Exception

Validate when the consequence of bad input is **irreversible harm**: SQL injection, unauthorized data deletion, financial transactions. These are real security boundaries. An AI returning `operator: "between"` instead of `operator: "gt"` is not a security boundary. It's a feature request the schema didn't anticipate.
