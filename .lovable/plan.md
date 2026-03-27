

# Elevating Dream State to 0.1% — Cognitive Manifestation Engine

## The Gap

The current build is a beautiful, well-architected workspace with mock intelligence. To reach 0.1%, the system needs to **actually think**, **actually listen**, and **actually anticipate**. Everything below is technically possible today.

## What Changes

### 1. Real AI Backbone — Replace Every Mock with Lovable AI

The single highest-impact upgrade. Replace the keyword-matching `intent-engine.ts` and all mock AI responses with actual LLM calls via Lovable AI Gateway.

- **Sherpa becomes genuinely intelligent**: Natural language understanding, not keyword matching. "What's my riskiest position and why?" produces a real analytical response.
- **Document Q&A becomes real**: "Ask about this document" sends the document text + question to the LLM and streams a real answer.
- **Dataset insights become real**: "Generate insight" actually analyzes the data and returns genuine observations.
- **AI Brief generation becomes real**: The brief is synthesized from all open workspace objects' data, not a static string.

**Implementation**: One Supabase edge function (`supabase/functions/ai-chat/index.ts`) with streaming. A `useAI` hook wraps it. The intent engine calls the LLM with workspace context as system prompt. All existing UI surfaces stay identical — only the data source changes.

### 2. Voice as Primary Input — Web Speech API

Type is 2015. Voice is 2035. The Web Speech API is production-ready in all major browsers today.

- **Hold-to-speak microphone** on the Sherpa rail and Cmd+K palette
- Speech-to-text feeds directly into the same `processIntent` pipeline
- Subtle waveform visualization while listening (canvas element, ~40 lines)
- No transcription UI — the workspace just *responds* to your voice

This is a small implementation (~150 lines) with outsized impact on the feel of the product.

### 3. Cmd+K Command Palette — Contextual Intelligence Surface

A modal overlay triggered by `⌘K` / `Ctrl+K`. Not a simple command list — a **context-aware natural language input**.

- Shows what's currently focused, recent intents, and suggested next actions
- Typing routes through the same AI-powered intent engine
- Fuzzy-matches existing objects for focus/dissolve/pin actions
- Supports compound commands: "compare the two things I'm looking at"
- Keyboard-first, mouse-optional — power user velocity

### 4. Object Fusion — Drag-to-Synthesize

The most paradigm-breaking feature. Drag one object onto another → AI synthesizes a new object from both.

- Metric + Document → Annotated analysis ("Here's where the document discusses this metric's trajectory")
- Dataset + Alert → Filtered view showing only the rows relevant to the alert
- Two Metrics → Auto-generated comparison object
- Any combination → AI-generated brief synthesizing both contexts

**Implementation**: Detect drag-overlap in FreeformCanvas. Show a "fusion zone" glow. On drop, send both objects' context data to the LLM with a synthesis prompt. Materialize the result as a new `brief` or `comparison` object with both originals as relationships.

### 5. Cognitive Mode System — Workspace Atmosphere Shifts

The workspace changes its entire character based on what you're doing. Not a theme toggle — an **automatic cognitive atmosphere**.

```text
Mode        │ Trigger                    │ Visual Feel              │ Behavior
────────────┼────────────────────────────┼──────────────────────────┼──────────────────
Research    │ Multiple objects open,     │ Warm, expansive,         │ Objects spread,
            │ browsing behavior          │ soft amber tones         │ relationships visible
────────────┼────────────────────────────┼──────────────────────────┼──────────────────
Analysis    │ Immersive mode,            │ Cool, focused,           │ Single object dominant,
            │ deep interaction           │ higher contrast          │ others dimmed
────────────┼────────────────────────────┼──────────────────────────┼──────────────────
Decision    │ Alerts present,            │ Crisp, urgent,           │ Alerts promoted,
            │ comparison active          │ slight edge tension      │ actions highlighted
────────────┼────────────────────────────┼──────────────────────────┼──────────────────
Synthesis   │ Brief generation,          │ Calm, distilled,         │ Everything recedes
            │ export actions             │ minimal density          │ except the output
```

**Implementation**: A `useCognitiveMode` hook observes workspace state (object types, interaction patterns) and derives the current mode. CSS custom properties shift via transitions on `<body>`. Subtle, not dramatic — the user *feels* it more than *sees* it.

### 6. Predictive Materialization — AI Anticipates Your Next Need

The Sherpa doesn't just suggest — it **pre-loads**.

- If you open a metric, the system silently prepares the related comparison data
- If you focus on an alert, the relevant document section is pre-fetched
- A subtle shimmer in the Sherpa rail indicates "I have something ready"
- One click materializes the pre-loaded object instantly (no delay)

**Implementation**: After each `MATERIALIZE_OBJECT` or `FOCUS_OBJECT`, a background AI call predicts likely next actions. Results are cached in state as `pendingMaterializations`. The Sherpa shows a pulsing dot when predictions are ready.

### 7. Workspace-to-Artifact Export — One Command, Full Briefing

"Export this workspace" generates a structured document from everything currently open.

- AI synthesizes all open objects into a coherent narrative
- Output as a formatted briefing (rendered in immersive mode, downloadable as PDF)
- Respects spatial hierarchy: primary objects get detailed treatment, secondary gets summary
- Includes relationship map as a visual diagram

### 8. Ambient Sound Design — Web Audio API

Subtle, almost subliminal audio cues that make the workspace feel alive:

- Soft chime on object materialization
- Gentle tone shift when entering immersive mode
- Quiet pulse when an alert arrives
- Atmospheric hum that subtly changes with cognitive mode

**Implementation**: A `useAmbientAudio` hook with Web Audio API oscillators. All sounds procedurally generated (no audio files). Master volume control, default very low. Can be muted.

### 9. Workspace Persistence + Memory Graph

- `localStorage` serialization of full `WorkspaceState` — survive page refreshes
- Session history: "You explored leverage → comparison → alerts yesterday. Resume?"
- Frequently accessed objects get auto-pinned suggestions
- Sherpa references past sessions: "Last time you looked at Beta's leverage, it was at 3.2x. It's now 3.6x."

### 10. Living Sparklines + Real-time Pulse

Objects shouldn't feel static. Even with mock data:

- Sparklines animate on mount (draw-in effect)
- Metric values have subtle count-up animations
- A "last updated" pulse indicator on data objects
- Periodic micro-animations that make objects feel alive (breathing border glow)

---

## Implementation Order (Priority)

1. **Real AI backbone** — highest ROI, transforms everything from demo to product
2. **Cmd+K command palette** — makes the workspace feel like a power tool
3. **Voice input** — small effort, massive "future" signal
4. **Cognitive mode system** — ambient atmosphere that no competitor has
5. **Object fusion** — paradigm-breaking interaction model
6. **Living animations + sparkline draw-in** — polish that signals quality
7. **Workspace persistence** — expected functionality
8. **Ambient sound design** — the detail that makes people say "wow"
9. **Predictive materialization** — requires AI backbone first
10. **Workspace-to-artifact export** — requires AI backbone first

## Technical Architecture

```text
┌─────────────────────────────────────────────────────┐
│                    Frontend                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Cmd+K    │  │ Voice    │  │ Sherpa Rail       │ │
│  │ Palette  │  │ Input    │  │ (+ ambient hints) │ │
│  └────┬─────┘  └────┬─────┘  └────────┬──────────┘ │
│       └──────────────┴────────────────┘              │
│                      │                               │
│            processIntent(query)                      │
│                      │                               │
│         ┌────────────▼────────────┐                  │
│         │  AI Intent Engine       │                  │
│         │  (LLM-powered, not     │                  │
│         │   keyword matching)     │                  │
│         └────────────┬────────────┘                  │
│                      │                               │
│    ┌─────────────────┼──────────────────┐            │
│    │                 │                  │            │
│    ▼                 ▼                  ▼            │
│ CREATE            RESPOND           PREDICT          │
│ objects           with real          next need        │
│                   analysis                           │
│                                                      │
│  ┌──────────────────────────────────────────┐        │
│  │  Cognitive Mode Engine                    │        │
│  │  Observes state → shifts atmosphere       │        │
│  └──────────────────────────────────────────┘        │
│                                                      │
│  ┌──────────────────────────────────────────┐        │
│  │  Fusion Engine                            │        │
│  │  Object + Object → Synthesized Object     │        │
│  └──────────────────────────────────────────┘        │
└──────────────────────┬──────────────────────────────┘
                       │
              Supabase Edge Function
                       │
              Lovable AI Gateway
              (google/gemini-3-flash-preview)
```

## Files Created/Modified

**New files:**
- `supabase/functions/ai-chat/index.ts` — Edge function for AI gateway
- `src/hooks/useAI.ts` — Streaming AI hook
- `src/hooks/useCognitiveMode.ts` — Atmosphere detection
- `src/hooks/useVoiceInput.ts` — Web Speech API wrapper
- `src/hooks/useAmbientAudio.ts` — Procedural sound design
- `src/hooks/useWorkspacePersistence.ts` — localStorage serialization
- `src/components/workspace/CommandPalette.tsx` — Cmd+K overlay
- `src/components/workspace/FusionZone.tsx` — Drag-to-synthesize UI
- `src/components/workspace/VoiceIndicator.tsx` — Waveform viz
- `src/lib/cognitive-modes.ts` — Mode detection logic

**Modified files:**
- `src/lib/intent-engine.ts` — Replace keyword matching with LLM routing
- `src/hooks/useWorkspaceActions.ts` — Wire AI calls
- `src/components/workspace/SherpaRail.tsx` — Voice button, prediction indicators
- `src/components/workspace/FreeformCanvas.tsx` — Fusion detection
- `src/components/workspace/WorkspaceShell.tsx` — Cognitive mode classes, command palette
- `src/components/objects/DocumentReader.tsx` — Real AI Q&A
- `src/components/objects/DatasetView.tsx` — Real AI insights
- `src/components/objects/MetricDetail.tsx` — Animated sparklines
- `src/index.css` — Cognitive mode CSS variables, new animations
- `src/contexts/WorkspaceContext.tsx` — Persistence, prediction state

