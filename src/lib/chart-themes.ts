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

export const CHART_THEMES: Record<string, ChartTheme> = {
  frosted: {
    colors: ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'],
    background: 'transparent',
    text: '#6b7280',
  },
  corporate: {
    colors: ['#1e3a5f', '#2563eb', '#0ea5e9', '#64748b', '#94a3b8'],
    background: 'transparent',
    text: '#374151',
  },
  neon: {
    colors: ['#00ff88', '#00d4ff', '#ff006e', '#fb5607', '#ffbe0b'],
    background: 'transparent',
    text: '#d1d5db',
  },
  midnight: {
    colors: ['#818cf8', '#a78bfa', '#c084fc', '#e879f9', '#f472b6'],
    background: 'transparent',
    text: '#c4b5fd',
  },
  earth: {
    colors: ['#78350f', '#b45309', '#d97706', '#65a30d', '#047857'],
    background: 'transparent',
    text: '#6b7280',
  },
};
