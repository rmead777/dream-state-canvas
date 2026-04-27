# Mobile Optimization Build Plan

## Objective
Make Dream State Canvas fully usable on mobile/tablet devices. The current layout is desktop-first with a fixed sidebar rail and freeform/auto canvas. Mobile needs a fundamentally different layout — not just responsive scaling.

## Current State
- **Desktop layout**: Fixed Sherpa rail (right sidebar ~350px) + canvas (remaining width) + bottom WorkspaceBar
- **Cards**: min-width ~320px, freeform draggable or auto-layout zones (primary/secondary/peripheral)
- **Immersive view**: Full-screen overlay, works OK on tablets but cramped on phones
- **SherpaRail**: Fixed right panel with tabs (Origin, Memory, Rules, Context, Admin, Log)
- **No mobile breakpoints**: No `@media` queries for mobile, no responsive variants
- **No touch gestures**: Drag handles use mouse events only (dnd-kit may support touch)

## Design Philosophy
Mobile should feel like a **command-line-first interface** — Sherpa chat is the primary interaction surface, cards are secondary. On desktop, cards and chat coexist side-by-side. On mobile, chat dominates and cards are accessed via tap/swipe.

## Proposed Layout

### Phone (< 768px)
```
┌─────────────────────┐
│ [≡] Sherpa    [⊞]   │  ← Minimal top bar: menu + canvas toggle
├─────────────────────┤
│                     │
│   Chat / Card View  │  ← Full-screen, swipeable
│   (one at a time)   │
│                     │
├─────────────────────┤
│ [Chat] [Cards] [+]  │  ← Bottom tab bar
└─────────────────────┘
```

**Two modes:**
1. **Chat mode** (default): Full-screen Sherpa conversation with input at bottom. Cards appear inline in the chat as compact previews — tap to expand.
2. **Cards mode**: Vertical stack of cards, swipe left/right to collapse/dissolve. Tap to expand to full-screen immersive view.

### Tablet (768px - 1024px)
```
┌──────────────┬──────────┐
│              │          │
│   Canvas     │  Sherpa  │
│   (cards)    │  Rail    │
│              │  (narrow)│
├──────────────┴──────────┤
│     Bottom Bar          │
└─────────────────────────┘
```
- Same as desktop but Sherpa rail narrows to ~280px
- Cards stack vertically (no side-by-side primary/secondary zones)
- Immersive view works as-is

### Desktop (> 1024px)
- No changes — current layout

## Build Steps

### Step 1: Add Tailwind responsive breakpoints
- Define `sm`, `md`, `lg` breakpoints in tailwind.config.ts (if not already there)
- Audit existing components for hardcoded widths

### Step 2: Mobile layout shell
- New `MobileShell.tsx` component (replaces `WorkspaceShell` on small screens)
- Bottom tab bar: Chat | Cards | Context
- Full-screen chat view with existing PromptEditor
- Full-screen card stack view

### Step 3: Responsive SherpaRail
- On mobile: becomes full-screen chat view (no sidebar)
- On tablet: narrows to ~280px
- On desktop: unchanged (~350px)

### Step 4: Responsive cards
- On mobile: cards render as compact preview strips (title + one-line summary)
- Tap → full-screen immersive view (existing ImmersiveOverlay)
- Swipe gestures for collapse/dissolve (optional polish)

### Step 5: Touch-friendly interactions
- Larger tap targets (min 44px per Apple HIG)
- Drag handles → swipe gestures on mobile
- Long-press for card actions (pin, dissolve, expand)
- Pull-to-refresh for email/QB sync

### Step 6: Mobile-specific optimizations
- Reduce chart heights on small screens
- Stack metrics-row vertically instead of horizontally
- Collapse Context tab panels by default
- Lazy-load immersive view content
- Reduce font sizes proportionally

### Step 7: PWA support (optional)
- Add manifest.json for "Add to Home Screen"
- Service worker for offline shell
- This makes DSC feel like a native app on mobile

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/components/workspace/MobileShell.tsx` | **CREATE** — Mobile layout shell |
| `src/components/workspace/MobileTabBar.tsx` | **CREATE** — Bottom tab navigation |
| `src/components/workspace/MobileCardStack.tsx` | **CREATE** — Vertical card list for mobile |
| `src/components/workspace/WorkspaceShell.tsx` | **MODIFY** — Detect screen size, render MobileShell or desktop shell |
| `src/components/workspace/SherpaRail.tsx` | **MODIFY** — Responsive width, mobile full-screen mode |
| `src/components/workspace/WorkspaceObject.tsx` | **MODIFY** — Compact mobile preview variant |
| `src/components/objects/AnalysisCard.tsx` | **MODIFY** — Responsive chart heights, stacked metrics |
| `src/components/workspace/ImmersiveOverlay.tsx` | **MODIFY** — Mobile padding/margins |
| `src/components/workspace/WorkspaceBar.tsx` | **MODIFY** — Hide on mobile (replaced by MobileTabBar) |
| `tailwind.config.ts` | **MODIFY** — Confirm responsive breakpoints |
| `src/index.css` | **MODIFY** — Mobile-specific overrides |

## Decisions (Resolved)
1. **Minimum supported width**: 390px (iPhone 14/15/16 standard — covers ~85% of active iPhones)
2. **Card preview format on mobile**: Compact strip (title + one-line summary). Tap opens full immersive view with ALL content — nothing is hidden or truncated. The preview is just a navigation affordance, not a reduced version. Full card content, charts, tables, actions — all accessible in immersive view exactly like desktop.
3. **Swipe gestures**: Yes — include swipe. Left-swipe to collapse, right-swipe to expand/immersive. People expect it.
4. **PWA**: Later session — not part of this build.

## What NOT to Do
- Don't build a separate mobile app — this should be one responsive SPA
- Don't hide features on mobile — same capabilities, different layout
- Don't use a mobile CSS framework — Tailwind's responsive utilities are sufficient
- Don't break the desktop layout while building mobile
