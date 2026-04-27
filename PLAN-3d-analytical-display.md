# 3D Analytical Display — Enhancement Spec

**Goal:** Transform the 3D scene renderer from "intro to WebGL" into a professional analytical viewport that looks at home in a Bloomberg/Palantir-class workspace.

**Scope:** Four enhancements, ordered by impact-to-effort ratio. Each is independently shippable.

---

## Enhancement 1: Container Upgrade (CSS/React only)

**Problem:** The 3D scene sits in a generic `rounded-lg border bg-gradient-to-b` wrapper. There's no title, no legend, no contextual framing. It could be any iframe.

**Changes to `ThreeDRenderer` export (wrapper div):**

### 1a. Dark viewport wrapper
Replace the current light gradient container with a dark analytical viewport:
```
- Remove: bg-gradient-to-b from-white to-workspace-surface/10
- Add: bg-[#0a0a12] rounded-xl overflow-hidden relative
- Add: inner shadow/vignette via pseudo-element or CSS gradient overlay
- Add: subtle 1px border with rgba(255,255,255,0.06) instead of workspace-border/20
```

### 1b. Scene title bar
Overlay a top bar inside the container (absolute positioned, above the Canvas):
- Left: Scene type label in small caps (e.g., "PARTICLE FLOW", "BAR CHART 3D")
- Right: Data summary (e.g., "13 vendors · $4.26M total")
- Style: frosted glass bar, `backdrop-blur-sm bg-black/30`, 10px text, tracking-wider
- This reads from `section.caption` if provided, otherwise auto-generates from data

### 1c. Legend overlay
Bottom-left corner, absolute positioned over the Canvas:
- Colored dots + vendor names (top N by value, rest as "+ N more")
- Max 6 items visible to avoid clutter
- Style: `text-[9px] text-white/60`, colored circles matching flow colors
- Only shown for scene types that use categorical colors (bar3d, pie3d, particleFlow, network, connectionMap)

### 1d. Value annotation
Bottom-right corner:
- Show the min/max/total of the value axis
- Format: "$5K — $192K" or "Total: $4.26M"
- Style: `text-[10px] font-mono text-white/50 tabular-nums`

### Files changed:
- `src/components/objects/ThreeDRenderer.tsx` — wrapper div and overlay components in the main `ThreeDRenderer` export

---

## Enhancement 2: Scene Environment (Three.js)

**Problem:** Objects float in a white void. No depth cues, no grounding, no atmosphere. This is the single biggest factor making it look amateur.

### 2a. Dark gradient background
Replace the transparent Canvas background with an in-scene gradient:
- Add a fullscreen quad behind everything with a radial gradient shader
- Center: `#12121a` (dark navy), edges: `#08080e` (near-black)
- This replaces `style={{ background: 'transparent' }}` on the Canvas — set `alpha: false` and render the gradient as a scene background
- Alternative: use `scene.background = new THREE.Color('#0e0e16')` for simplicity, add gradient as a post-processing vignette

### 2b. Ground plane with soft reflection
Replace the barely-visible `GridFloor` component:
- Semi-transparent dark plane at y=0 with subtle grid lines (white at 3% opacity)
- Reflective surface using drei's `<ContactShadows>` or a custom reflector
- Grid lines should be thin, evenly spaced, and fade at the edges (distance fade)
- For particleFlow: horizontal ground plane isn't appropriate — use a subtle horizontal line at y=0 instead, or skip the ground entirely

### 2c. Environment lighting
Replace the current flat two-point directional setup:
- Use drei's `<Environment preset="city" />` or similar for subtle ambient reflections on glossy materials
- Reduce direct light intensity, increase ambient slightly
- Add a subtle rim light (backlight) for edge definition on 3D objects
- This makes the frosted glass materials actually look like glass

### 2d. Atmosphere/fog
- Add subtle distance fog: `<fog attach="fog" args={['#0e0e16', 8, 20]} />`
- This creates depth — far objects fade slightly, giving the scene spatial reading
- Fog color matches the background gradient center

### Files changed:
- `src/components/objects/ThreeDRenderer.tsx` — Canvas props, new background/environment components, updated GridFloor, fog
- Possibly new `SceneEnvironment.tsx` sub-component if the setup gets complex

### Dependencies:
- drei's `<Environment>` is already available (drei is imported)
- `<ContactShadows>` from drei — already in the bundle
- No new packages needed

---

## Enhancement 3: Data Overlays (drei `<Html>`)

**Problem:** The 3D scene tells you nothing on its own. You can see relative sizes and colors, but you can't read actual values without looking at the card above. Professional analytical tools show data-in-context.

### 3a. Value tooltips on hover
- Use drei's `<Html>` component to render HTML tooltips anchored to 3D positions
- On hover over a bar/node/tube, show a small dark tooltip: vendor name, value, % of total
- Style: `bg-black/80 backdrop-blur-sm rounded-md px-2 py-1 text-[10px] text-white`
- Pointer events on the Canvas meshes via `onPointerOver`/`onPointerOut`
- Only implement for bar3d, pie3d, and particleFlow initially

### 3b. Axis labels for bar3d/scatter3d
- Use `<Html>` to render proper axis labels that always face the camera
- X-axis: category labels (already exist as Text, but in 3D space — make them HTML so they're always readable)
- Y-axis: value scale with tick marks (e.g., "$0", "$50K", "$100K", "$150K", "$200K")
- Style: same dark tooltip aesthetic, but fixed position relative to axis

### 3c. ParticleFlow value labels
- Add small value annotations next to each source marker: "$192K", "$45K", etc.
- Use `<Html>` so they're always readable regardless of camera angle
- Fade/hide labels below a certain value threshold to avoid clutter (show top 5-6, hide rest)
- The destination hub shows the total: "$4.26M"

### 3d. Interactive legend (click to isolate)
- Upgrade the CSS legend from Enhancement 1c to be interactive
- Click a vendor name → other flows/bars dim to 10% opacity, selected one highlights
- Click again to deselect (show all)
- Requires passing a `highlightedIndex` state down to scene components

### Files changed:
- `src/components/objects/ThreeDRenderer.tsx` — Html overlays, hover state, interactive legend state
- Individual scene components (Bar3DScene, ParticleFlowScene, etc.) — hover handlers, opacity control

### Notes:
- drei's `<Html>` renders real DOM elements positioned in 3D space — great for text that needs to be readable at any angle
- Hover detection in Three.js via R3F is performant — uses raycasting only on pointer move
- The interactive legend is the most complex item here — could be deferred to a later pass

---

## Enhancement 4: ParticleFlow-Specific Polish

**Problem:** The tube flow is visually interesting but doesn't communicate data rigorously. A professional would ask: "What do the widths mean? What's the scale? Where are the numbers?"

### 4a. Funnel convergence at destination
- Instead of all tubes converging to a single point at x=5, add a funnel/cone shape
- The funnel mouth width = proportional to total AP value
- Tubes merge into the funnel gradually (adjust p2/p3 control points)
- The hub sphere sits at the narrow end of the funnel
- This visually communicates "all this pressure converges into your cash position"

### 4b. Value scale reference
- Add a small scale bar in the bottom-left of the 3D scene
- Shows what tube widths mean: thin line = "$5K", thick line = "$200K"
- Rendered as two short tube segments with labels via `<Html>`

### 4c. Flow pulse on critical vendors
- Vendors flagged as critical (via a `critical` or `priority` field in data) get a pulsing glow effect
- Implemented as a second slightly-larger tube behind the main one with animated opacity
- The AI already passes risk/priority data — just need to read it from the data record

### 4d. Time-based flow entrance
- Instead of all tubes appearing instantly, stagger their entrance
- Tubes animate in from source to destination over 1-2 seconds, top-to-bottom by value
- Uses the existing `easeOutCubic` from `useAnimationTimeline`
- After entrance animation completes, normal flow animation takes over

### 4e. Hub pressure indicator
- The destination hub sphere pulses/breathes based on total AP vs. available cash
- If AI passes `totalAP` and `availableCash` in the data, the hub color shifts:
  - Green: AP < 50% of cash (comfortable)
  - Yellow: AP 50-100% of cash (watch)  
  - Red: AP > cash (pressure)
- Pulsing speed increases with pressure ratio

### Files changed:
- `src/components/objects/ThreeDRenderer.tsx` — ParticleFlowScene internals, FlowTube component, hub component
- `src/lib/threed-settings.ts` — new settings for entrance animation speed, pulse intensity

---

## Implementation Order

| Phase | Enhancement | Effort | Impact |
|-------|-----------|--------|--------|
| **1** | 1a-d: Container upgrade | ~1 hour | High — instant "pro" framing |
| **2** | 2a-d: Scene environment | ~2 hours | Highest — transforms the entire feel |
| **3** | 4a, 4d, 4e: Flow-specific polish | ~2 hours | High for particleFlow scenes |
| **4** | 3a-c: Data overlays | ~2 hours | Medium — adds data readability |
| **5** | 3d, 4b, 4c: Interactive features | ~3 hours | Medium — power-user features |

Phases 1-2 are the priority — they transform every 3D scene type from "demo" to "analytical viewport" with no per-scene logic changes. Phases 3-5 add data richness and are more surgical.

---

## Design References

The target aesthetic is:
- **Dark mode analytical**: Think Bloomberg Terminal, Palantir Gotham, or Mapbox Studio
- **Frosted glass on dark**: The existing card design language, but applied to the 3D viewport
- **Data-dense but not cluttered**: Show numbers where they matter, hide them where they don't
- **The 3D should earn its place**: If the same data is better as a 2D chart, the 3D scene should add spatial insight (flow direction, convergence, relative volume) that a 2D chart can't

## Admin Panel Integration

All new settings should follow the existing `threed-settings.ts` pattern:
- New slider group "Environment" in ThreeDControlPanel: fog density, ground opacity, background brightness
- New slider group "Overlays" in ThreeDControlPanel: label visibility threshold, tooltip delay
- Presets updated to include environment settings
