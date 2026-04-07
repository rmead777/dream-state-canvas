/**
 * Chart Themes — named color palettes for chart and vegalite sections.
 *
 * The AI can reference these by name (e.g. theme: "frosted") instead of
 * specifying hex codes. The renderer resolves the name to a palette.
 */

export interface ChartTheme {
  colors: string[];
  background?: string;
  text?: string;
}

/**
 * Default palette: muted, professional, high-contrast-on-white.
 * Desaturated tones that look like a Bloomberg terminal or McKinsey deck,
 * not a toy store. Every theme must clear the "would a CFO present this?" bar.
 */
export const CHART_THEMES: Record<string, ChartTheme> = {
  // ─── DEFAULT — used when AI doesn't specify a theme ─────────────────────
  frosted: {
    colors: ['#4f5d75', '#2b6777', '#7a6c5d', '#8b5a5a', '#5b6e8a', '#6b7f6b', '#826a82', '#5d7a8a', '#8a7a5d', '#6d5d7a'],
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
