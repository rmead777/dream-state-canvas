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
  ocean: {
    colors: ['#0c4a6e', '#0369a1', '#0ea5e9', '#38bdf8', '#7dd3fc', '#bae6fd'],
    background: 'transparent',
    text: '#475569',
  },
  sunset: {
    colors: ['#9f1239', '#e11d48', '#f43f5e', '#fb923c', '#fbbf24', '#fde68a'],
    background: 'transparent',
    text: '#6b7280',
  },
  forest: {
    colors: ['#14532d', '#166534', '#22c55e', '#4ade80', '#86efac'],
    background: 'transparent',
    text: '#374151',
  },
  royal: {
    colors: ['#312e81', '#4338ca', '#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe'],
    background: 'transparent',
    text: '#4b5563',
  },
  warm: {
    colors: ['#9a3412', '#ea580c', '#f97316', '#fb923c', '#fdba74', '#fed7aa'],
    background: 'transparent',
    text: '#6b7280',
  },
  monochrome: {
    colors: ['#111827', '#374151', '#6b7280', '#9ca3af', '#d1d5db', '#e5e7eb'],
    background: 'transparent',
    text: '#374151',
  },
  candy: {
    colors: ['#db2777', '#e879f9', '#c084fc', '#818cf8', '#38bdf8', '#2dd4bf'],
    background: 'transparent',
    text: '#6b7280',
  },
  finance: {
    colors: ['#1e3a5f', '#10b981', '#ef4444', '#f59e0b', '#6366f1', '#8b5cf6'],
    background: 'transparent',
    text: '#374151',
  },
};
