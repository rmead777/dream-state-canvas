

# Fusion Discipline & Drillback System

## What GPT 5.4 identified correctly

The fusion system currently allows any two objects to fuse with no quality gates, no drillback, and no synthesis-type labeling. This risks "AI compost heap" accumulation. The fixes are concrete and implementable now.

## Changes

### 1. Synthesis Quality Framing (AIBrief.tsx)
Add a visible synthesis-type label to every fused object. The AI prompt already returns structured JSON — we add a `synthesisType` field to the fusion prompt and display it as a subtle badge:
- **Direct Extraction** — data was pulled and combined
- **Inferred Pattern** — AI detected a non-obvious relationship
- **Speculative Synthesis** — AI is extrapolating beyond the data

Display as a small pill next to the confidence bar. The AI chooses the type; no user input needed.

### 2. Fusion Compatibility Rules (FreeformCanvas.tsx)
Add a compatibility matrix that gates which object pairs can fuse. Compatible pairs:
- metric + dataset ✓
- metric + metric ✓
- document + dataset ✓
- brief + dataset ✓
- document + metric ✓
- comparison + metric ✓
- alert + metric ✓
- dataset + dataset ✓

Incompatible (no fusion glow, no drop):
- brief + brief (prevents recursive summary sludge)
- timeline + timeline
- two objects with no data context

When incompatible objects are dragged near each other, the proximity glow simply doesn't appear. No error message needed.

### 3. Ancestry & Unfuse (AIBrief.tsx)
Upgrade the existing "Synthesized From" section:
- Make source pills **clickable** — clicking focuses that source object in the workspace (dispatch `FOCUS_OBJECT`)
- Add a **"Reopen Sources"** button that restores collapsed/dissolved source objects
- Add an **"Unfuse"** button that dissolves the synthesis and restores both sources to visible state

### 4. Drillback — Expandable Source Context (AIBrief.tsx)
When the AI synthesis references data from a source, users should be able to drill back:
- Below the "Synthesized From" pills, add an expandable section per source showing a compact preview of that source's data (reuse existing object renderers in read-only/compact mode)
- Click to expand inline; click again to collapse
- This avoids needing to leave the synthesis to verify claims

### 5. Prompt Refinement (FreeformCanvas.tsx)
Update the fusion AI prompt to:
- Include `synthesisType` in the required JSON output schema
- Explicitly instruct: "Only produce this synthesis if the combination reveals something non-obvious. If the two objects are too similar or unrelated, say so in the response and set synthesisType to 'low-value'."
- If AI returns `synthesisType: 'low-value'`, show a toast suggesting the fusion isn't productive instead of creating a new object

## Files Modified
- `src/components/workspace/FreeformCanvas.tsx` — Compatibility matrix, prompt update, low-value gate
- `src/components/objects/AIBrief.tsx` — Synthesis type badge, clickable ancestry, unfuse button, drillback sections
- `src/components/workspace/FusionZone.tsx` — Show incompatibility state if needed (minor)

## What This Does NOT Change
- Existing drag mechanics, proximity glow, or canvas layout
- The AI model or edge function
- Any other workspace object types

