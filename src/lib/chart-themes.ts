/**
 * Chart Themes — named color palettes for chart and vegalite sections.
 *
 * The AI can reference these by name (e.g. theme: "default") instead of
 * specifying hex codes. The renderer resolves the name to a palette.
 */

export interface ChartTheme {
  colors: string[];
  background?: string;
  text?: string;
}

/**
 * Default palette: frosted glass translucence — soft pastel fills at 25% opacity
 * with full-opacity borders/strokes in the same hue. Light canvas, no dark mode.
 *
 * The fill opacity is enforced in AnalysisCard.tsx ChartRenderer, not here.
 * These colors are the BORDER/STROKE colors (full opacity). Fills use the same
 * color at 0.25 opacity for the frosted glass effect.
 */
export const CHART_THEMES: Record<string, ChartTheme> = {
  // ─── DEFAULT — frosted glass: pastel fills + opaque borders ─────────────
  default: {
    colors: [
      '#2b3a67',  // Navy
      '#4a7c8f',  // Steel Blue
      '#7aafc4',  // Arctic
      '#6b9e7a',  // Sage
      '#e8b87a',  // Peach
      '#d4868a',  // Rose
      '#d4b896',  // Champagne
      '#b04a4f',  // Crimson
      '#d48a6a',  // Coral
      '#5a8a9a',  // Steel Blue (lighter)
    ],
    background: 'transparent',
    text: '#6b7280',
  },
  corporate: {
    colors: ['#1e3a5f', '#3d6b8e', '#5a8dad', '#2d4a3e', '#6b5b4e'],
    background: 'transparent',
    text: '#374151',
  },
  neon: {
    colors: ['#00ff88', '#00d4ff', '#ff006e', '#fb5607', '#ffbe0b'],
    background: 'transparent',
    text: '#d1d5db',
  },
  midnight: {
    colors: ['#6366a0', '#7b6fa0', '#8e7db0', '#a08bb0', '#9a7da0'],
    background: 'transparent',
    text: '#8b8b9e',
  },
  earth: {
    colors: ['#5d4930', '#7a6040', '#8a7d5a', '#5a6e48', '#3d5a4a'],
    background: 'transparent',
    text: '#6b7280',
  },
  ocean: {
    colors: ['#1a3a5c', '#2a5a7a', '#3a7a9a', '#4a8aaa', '#5a9aba', '#6aacca'],
    background: 'transparent',
    text: '#475569',
  },
  sunset: {
    colors: ['#7a3040', '#9a4050', '#aa6050', '#ba8060', '#ca9a70', '#dab080'],
    background: 'transparent',
    text: '#6b7280',
  },
  forest: {
    colors: ['#2a4a30', '#3a5a3a', '#4a6a4a', '#5a7a5a', '#6a8a6a'],
    background: 'transparent',
    text: '#374151',
  },
  royal: {
    colors: ['#2a2860', '#3a3880', '#4a4890', '#5a58a0', '#6a68b0', '#7a78c0'],
    background: 'transparent',
    text: '#4b5563',
  },
  warm: {
    colors: ['#6a3a20', '#8a5030', '#9a6a40', '#aa7a50', '#ba8a60', '#ca9a70'],
    background: 'transparent',
    text: '#6b7280',
  },
  monochrome: {
    colors: ['#1a2030', '#3a4050', '#5a6070', '#7a8090', '#9aa0b0', '#bac0d0'],
    background: 'transparent',
    text: '#374151',
  },
  candy: {
    colors: ['#db2777', '#e879f9', '#c084fc', '#818cf8', '#38bdf8', '#2dd4bf'],
    background: 'transparent',
    text: '#6b7280',
  },
  finance: {
    colors: ['#1e3a5f', '#2d6a4f', '#8b3a3a', '#7a6a3a', '#4a4a7a', '#5a4a6a'],
    background: 'transparent',
    text: '#374151',
  },
};
