# Sherpa Rail + Bottom Bar Reorganization Spec

## Problem

The SherpaRail header is overloaded. Seven control buttons (admin, upload, rules, memory, history, clear, minimize) compete for ~200px of horizontal space as tiny icons with no labels. New users can't discover them. Power users can't distinguish them at a glance. Three different concerns share one row:

1. **Sherpa identity + conversation state** (name, mode, session pulse, clear, history, minimize)
2. **Workspace utilities** (upload, rules, memory, canvas controls, freeform toggle)
3. **Admin/debug tools** (model selector, token slider, context window)

These have different usage frequencies and different conceptual owners. Conversation controls are used every few minutes. Workspace utilities are used per-session. Admin tools are used rarely. They should not compete for the same space.

Additionally, the Freeform toggle (`LayoutToggle.tsx`) floats as a fixed button at bottom-right, disconnected from both the Sherpa and the collapsed bar. It belongs with the other workspace controls.

## Design Principles

- **Conversation controls stay with the conversation.** Clear, history, and minimize affect the Sherpa dialogue. They stay in the rail.
- **Workspace utilities move to a persistent bottom bar.** Upload, Rules, Memory, Canvas management, and Freeform toggle are workspace-level operations. They belong at screen bottom where they're always accessible regardless of Sherpa state.
- **Admin stays hidden until unlocked.** Admin controls remain in the Sherpa rail behind the passphrase gate, but get their own collapsible section rather than a header button.
- **Everything gets a label.** No more mystery icons. The bottom bar has room for labeled buttons.
- **The collapsed objects bar merges with the utility bar** into a single unified bottom strip with two zones.

## Architecture: What Changes

### Files Modified
- `src/components/workspace/SherpaRail.tsx` — remove utility buttons from header, remove Canvas menu from footer, remove upload/rules/memory panel rendering
- `src/components/workspace/CollapsedBar.tsx` — evolve into `WorkspaceBar.tsx` (or expand in place)
- `src/components/workspace/LayoutToggle.tsx` — delete (absorbed into bottom bar)
- `src/components/workspace/WorkspaceShell.tsx` — update component tree

### Files Created
- `src/components/workspace/WorkspaceBar.tsx` — new unified bottom bar
- `src/components/workspace/WorkspaceUtilities.tsx` — extracted utility panels (upload, rules, memory) that render as popovers/drawers from the bottom bar

### State Management
No new state needed. The existing `showUpload`, `showRules`, `showMemory` toggle states move from SherpaRail to WorkspaceBar (or to a shared context if both components need to trigger them). The simplest approach: lift these toggles into WorkspaceContext as a `ui` slice, or use a lightweight local context.

Recommended: create a small `UIContext` or just pass callbacks. Since these panels are mutually exclusive with the Sherpa scroll area, the cleanest approach is:

```typescript
// Add to WorkspaceState or a new UIContext:
interface WorkspaceUIState {
  activeUtilityPanel: 'upload' | 'rules' | 'memory' | null;
}
```

When a utility panel is open, it renders as a slide-up panel from the bottom bar OR as a popover anchored to the button. The Sherpa rail no longer renders these panels inline.

---

## Component Specs

### 1. SherpaRail (simplified)

The Sherpa rail becomes purely a conversation interface. It keeps:

**Header (slimmed):**
```
┌──────────────────────────────────────┐
│ ✦ SHERPA [mode badge]                │
│   Ambient guide for...    [▸ hide]   │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ [N live] [auto/manual] [scope]  │ │
│ │              [history] [clear]  │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

- Row 1: Sherpa identity (icon, name, mode badge) + minimize button
- Row 2: Status pills (live count, context mode, scope label) + conversation controls only (history toggle, clear)
- REMOVED from header: upload (↑), rules (⚙), memory (◈), admin (⚡)

**Body:** Unchanged. Session pulse card, response area, observations, suggestions.

**Footer (slimmed):**
```
┌──────────────────────────────────────┐
│ [Processing indicator if active]     │
│                                      │
│ ● Standing by                        │
│ Enter to send · Hold mic to dictate  │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ → Ask anything...    🎤  [Send] │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ⌘K · Sign out                        │
└──────────────────────────────────────┘
```

- REMOVED from footer: Canvas ▾ menu (moved to bottom bar)
- Keep: input, voice, send, processing indicator, ⌘K hint, sign out

**Target size:** SherpaRail should drop from ~729 lines to ~400-450 lines after extracting utility panels and controls.

### 2. WorkspaceBar (new unified bottom bar)

Replaces both `CollapsedBar.tsx` and `LayoutToggle.tsx`. Always visible at the bottom of the screen (except in immersive mode).

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ COLLAPSED ② │ ◆ Alert Panel │ ◇ Risk Brief │ ·· │ ↑ Upload │ ⚙ Rules │     │
│             │                               │    │ ◈ Memory │ ⊞ Canvas│     │
│                                                                     Freeform│
└──────────────────────────────────────────────────────────────────────────────┘
```

**Layout:** Single horizontal strip, full width, two zones separated by a subtle divider:

- **LEFT ZONE: Collapsed Objects** — exactly as current CollapsedBar, but integrated into the unified strip. Shows collapsed count badge + pill buttons for each collapsed object. Scrolls horizontally if many objects.

- **RIGHT ZONE: Workspace Utilities** — labeled icon+text buttons for:
  - **Upload** (↑ Upload) — opens upload panel as popover above the button
  - **Rules** (⚙ Rules) — opens rules editor as popover above the button
  - **Memory** (◈ Memory) — opens memory panel as popover above the button
  - **Canvas** (▾ Canvas) — opens canvas management menu (Minimize all, Clear canvas)
  - **Freeform / Auto** (⊞ Freeform / ≡ Auto) — direct toggle, no popover

**Admin controls:** NOT in the bottom bar. These stay in SherpaRail, activated by passphrase. They're debug/power-user tools that shouldn't be visible to regular users. When admin is unlocked, show the admin panel inline in the Sherpa rail body (as it currently works).

```typescript
// src/components/workspace/WorkspaceBar.tsx

import { useState, useCallback } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { RulesEditor } from './RulesEditor';
import { DocumentUpload } from './DocumentUpload';
import { MemoryPanel } from './MemoryPanel';
import { toast } from 'sonner';

type UtilityPanel = 'upload' | 'rules' | 'memory' | null;

export function WorkspaceBar() {
  const { state, dispatch } = useWorkspace();
  const { restoreObject } = useWorkspaceActions();
  const [activePanel, setActivePanel] = useState<UtilityPanel>(null);
  const [showCanvasMenu, setShowCanvasMenu] = useState(false);

  // ... collapsed objects logic (from current CollapsedBar) ...
  // ... utility button handlers ...
  // ... canvas management (minimize all, clear canvas) ...
  // ... freeform toggle ...
  // ... popover rendering for active panel ...
}
```

### 3. Utility Panel Rendering

When a utility button is clicked, its panel appears as a **popover anchored above the button**. Only one panel open at a time. Clicking the same button again closes it. Clicking a different button switches panels.

Use Radix Popover (already in dependencies via `@radix-ui/react-popover`) for proper positioning and outside-click dismissal.

```
                    ┌─────────────────┐
                    │  Upload Panel   │
                    │  Drop files...  │
                    │  XLSX, CSV...   │
                    └───────┬─────────┘
                            │
┌───────────────────────────┼──────────────────────────────────────┐
│ COLLAPSED ② │ ...  │  [↑ Upload]  │ ⚙ Rules │ ◈ Memory │ ...  │
└──────────────────────────────────────────────────────────────────┘
```

Panel dimensions:
- Upload: 320px wide, auto height
- Rules: 360px wide (needs room for the rules display + input)
- Memory: 380px wide, max-height 400px with scroll

Each panel gets the same styling as current SherpaRail cards: `workspace-card-surface rounded-2xl border border-workspace-border/45 px-4 py-4 shadow-lg`

### 4. Document Upload Integration

Currently, `handleDocumentIngested` lives in SherpaRail and calls `addDocument`, `setActiveDataset`, `clearProfileCache`, `invalidateProfileCache`. This logic needs to be accessible from the new WorkspaceBar.

**Option A (simpler):** Move `handleDocumentIngested` into a shared hook `useDocumentUpload` that both components can import.

**Option B (cleaner):** Move it into the existing `useWorkspaceActions` hook alongside other workspace-level operations.

Recommended: **Option A.** Create:

```typescript
// src/hooks/useDocumentUpload.ts
export function useDocumentUpload() {
  const { addDocument } = useDocuments();
  
  const handleDocumentIngested = useCallback(async (docId: string) => {
    // ... existing logic from SherpaRail ...
  }, [addDocument]);

  return { handleDocumentIngested };
}
```

---

## Interaction Details

### Bottom Bar Visibility
- Always visible when NOT in immersive mode (same rule as current CollapsedBar)
- In immersive mode: fully hidden (same as current)
- If no collapsed objects AND no active utility panel: the bar still shows the utility buttons on the right. The left zone shows "No collapsed objects" or is simply empty/compact.

### Bottom Bar Height
- Default: ~52px (single row, comfortable touch targets)
- With popover open: popover floats above, bar stays at 52px

### Popover Behavior
- Opens upward from the button
- Closes on: click same button, click outside, press Escape
- Only one popover at a time
- Animate with existing `materialize` keyframe

### Mobile Consideration
- On narrow screens (<768px), utility buttons collapse to icons only (no labels)
- Popovers become bottom sheets (slide up from bottom edge, full width)
- This is a future enhancement, not required for this sprint

### Keyboard
- Tab through utility buttons
- Enter/Space to toggle popovers
- Escape to close active popover
- Existing ⌘K shortcut unaffected

---

## Migration Checklist

### Step 1: Create WorkspaceBar
- Create `src/components/workspace/WorkspaceBar.tsx`
- Port collapsed objects rendering from `CollapsedBar.tsx`
- Add utility buttons (Upload, Rules, Memory, Canvas, Freeform)
- Add popover infrastructure for panels
- Add Canvas management menu (Minimize all, Clear canvas)
- Integrate Freeform/Auto toggle (absorb `LayoutToggle.tsx` logic)

### Step 2: Extract useDocumentUpload hook
- Create `src/hooks/useDocumentUpload.ts`
- Move `handleDocumentIngested` logic from SherpaRail
- Import in WorkspaceBar's upload panel

### Step 3: Slim SherpaRail header
- Remove utility buttons from Row 2 (keep only history + clear)
- Remove upload/rules/memory panel rendering from body
- Remove Canvas ▾ menu from footer
- Keep admin panel rendering (it stays in Sherpa rail, behind passphrase)
- Verify all toggle states that moved out are properly removed

### Step 4: Update WorkspaceShell
- Replace `<CollapsedBar />` with `<WorkspaceBar />`
- Remove `<LayoutToggle />` (absorbed into WorkspaceBar)
- Verify immersive mode hides WorkspaceBar correctly

### Step 5: Delete obsolete files
- Delete `src/components/workspace/CollapsedBar.tsx`
- Delete `src/components/workspace/LayoutToggle.tsx`

### Step 6: Verify
- All utility panels open/close correctly from bottom bar
- Collapsed objects still restore on click
- Freeform toggle works
- Canvas minimize/clear works
- Admin controls still work via passphrase in Sherpa rail
- Upload → dataset activation still works
- ⌘K command palette unaffected
- No broken imports

---

## Visual Design Notes

### Bottom Bar Styling
```css
/* Match existing workspace aesthetic */
.workspace-bar {
  @apply border-t border-workspace-border/50 bg-white/70 backdrop-blur-md;
  @apply px-4 py-2.5;
  @apply flex items-center gap-3;
}
```

### Utility Button Styling
```css
/* Labeled buttons — more discoverable than icon dots */
.utility-button {
  @apply flex items-center gap-1.5;
  @apply rounded-full border border-workspace-border/50;
  @apply px-3 py-1.5;
  @apply text-[11px] font-medium text-workspace-text-secondary;
  @apply transition-all duration-200;
  @apply hover:border-workspace-accent/20 hover:text-workspace-accent;
  @apply hover:bg-workspace-accent/5;
}

.utility-button--active {
  @apply border-workspace-accent/25 bg-workspace-accent/8 text-workspace-accent;
  @apply shadow-[0_8px_20px_rgba(99,102,241,0.1)];
}
```

### Zone Separator
A subtle vertical line between collapsed objects and utilities:
```css
.zone-separator {
  @apply h-6 w-px bg-workspace-border/40 mx-2;
}
```

### Spacing
- Collapsed objects zone: takes available space, scrolls horizontally
- Utility zone: fixed width, right-aligned, never scrolls
- This means on narrow screens, collapsed objects get squeezed first (which is fine — they're pills that scroll)

---

## What NOT to Change

- **SherpaRail conversation flow.** Session pulse, response area, NOTICED observations, suggestion chips, input area — all unchanged.
- **Admin panel.** Stays in Sherpa rail behind passphrase. This is intentional: admin controls are a debug/power-user feature, not a workspace utility.
- **Processing animation.** Stays in Sherpa rail footer, above the input.
- **Voice input.** Stays in Sherpa rail input area.
- **⌘K Command Palette.** Completely separate, unaffected.
- **WorkspaceObject component.** No changes.
- **Any lib/ files.** This is purely a UI reorganization.

---

## Expected Outcome

**Before:** SherpaRail = 729 lines, 7 toggle states, overloaded header with mystery icons.

**After:** 
- SherpaRail = ~400 lines, 2 toggle states (history, admin), clean conversation-focused interface
- WorkspaceBar = ~200 lines, unified bottom strip with labeled utilities + collapsed objects
- Better discoverability, clearer separation of concerns, room to grow
