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

Dream State Canvas is an AI-powered analytical workspace where users upload documents (spreadsheets, PDFs, etc.) and interact with them through natural language. The app materializes data as "workspace objects" — cards that appear, collapse, fuse together, and dissolve — on a spatial canvas. An AI assistant called "Sherpa" observes workspace state and proactively offers suggestions.

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
    → intent-engine.parseIntentAI() — LLM parses intent into structured actions
      (falls back to keyword-based parseIntent() on failure)
    → Actions dispatched to WorkspaceContext reducer
      → Objects materialize/focus/dissolve/update on canvas
```

### Three Context Providers (nested in Index.tsx)

1. **WorkspaceContext** — `useReducer`-based state for all workspace objects, spatial layout, and Sherpa state. The reducer handles ~20 action types (MATERIALIZE_OBJECT, DISSOLVE_OBJECT, FOCUS_OBJECT, etc.). All layout recomputation goes through `computeLayout()` from `spatial-orchestrator.ts`.

2. **SherpaContext** — Intelligence layer that observes workspace state on a 30-second interval and when object count changes. Generates proactive suggestions and observations via `sherpa-engine.ts`. Reads from WorkspaceContext.

3. **DocumentContext** — Manages uploaded documents from Supabase. Tracks the "active dataset" (columns + rows) used by data-derived objects. Falls back to `CANONICAL_DATASET` from `seed-data.ts` when no documents are uploaded.

### Workspace Object System (`lib/workspace-types.ts`)

Objects have a lifecycle: `materializing → open → collapsed → dissolved`. Nine types: `metric`, `comparison`, `alert`, `inspector`, `brief`, `timeline`, `monitor`, `document`, `dataset`. Each type has a corresponding renderer in `components/objects/`.

Objects are placed in spatial zones (`primary`, `secondary`, `peripheral`) by `spatial-orchestrator.ts` with a hard cap of 2 primary + 2 secondary visible objects.

### AI Integration

- `hooks/useAI.ts` — exposes `useAI()` (streaming hook) and `callAI()` (non-streaming). Both call the Supabase `ai-chat` edge function at `VITE_SUPABASE_URL/functions/v1/ai-chat`. Streams use SSE with OpenAI-compatible `data:` lines.
- `lib/data-analyzer.ts` — `DataProfile` is an AI-generated schema analysis (domain, key columns, sort rules, display columns). Cached in localStorage with version key. Profile drives all data slicing.
- `lib/data-slicer.ts` — Pure deterministic functions that derive preview subsets using the DataProfile. Respects ordinal priority columns (tier-based sorting) above numeric sorting.
- `lib/fusion-executor.ts` — AI-synthesizes two workspace objects into a new "brief" object. Uses `fusion-rules.ts` to block incompatible pairs.

### Key Hooks

- `useWorkspaceActions` — Orchestrates intent processing, object CRUD, fusion execution, and data rule refinement. The main action dispatcher.
- `useWorkspacePersistence` — Saves/restores workspace state.
- `useCognitiveMode` — Tracks user engagement patterns.
- `useWorkspaceBreathing` — Monitors object density, triggers over-capacity warnings.

### Tailwind Design Tokens

Custom `workspace-*` color tokens defined in `tailwind.config.ts` and set via CSS variables: `workspace-bg`, `workspace-surface`, `workspace-accent`, `workspace-text`, `workspace-text-secondary`, `workspace-border`.

### Supabase Edge Functions

Located in `supabase/functions/`:
- `ai-chat` — Main AI endpoint (intent parsing, brief generation, chat)
- `ai-image` — Image generation
- `ingest-document` — Document upload processing (spreadsheet parsing, PDF extraction, AI analysis)

### Environment Variables

Configured via `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (loaded through Vite's `import.meta.env`).
