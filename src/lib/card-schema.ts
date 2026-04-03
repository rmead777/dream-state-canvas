/**
 * Card Schema — Zod schemas for the analysis super-type.
 *
 * Defines section types (summary, narrative, metric, table, callout, etc.)
 * and the DataQuery schema for AI-driven data selection.
 *
 * All AI-generated card content is validated through these schemas
 * before reaching the renderer. Invalid sections are dropped, not crashed.
 */
import { z } from 'zod';

// ─── Section Types ───────────────────────────────────────────────────────────

export const SummarySection = z.object({
  type: z.literal('summary'),
  text: z.string(),
});

export const NarrativeSection = z.object({
  type: z.literal('narrative'),
  text: z.string(),
});

export const MetricSection = z.object({
  type: z.literal('metric'),
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  unit: z.string().optional(),
  trend: z.enum(['up', 'down', 'flat']).optional(),
  trendLabel: z.string().optional(),
});

export const TableSection = z.object({
  type: z.literal('table'),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
  highlights: z.array(z.object({
    column: z.string(),
    condition: z.string(),
    style: z.enum(['warning', 'danger', 'success', 'info']),
  })).optional(),
  caption: z.string().optional(),
});

export const CalloutSection = z.object({
  type: z.literal('callout'),
  severity: z.enum(['info', 'warning', 'danger', 'success']),
  text: z.string(),
});

export const MetricsRowSection = z.object({
  type: z.literal('metrics-row'),
  metrics: z.array(z.object({
    label: z.string(),
    value: z.union([z.string(), z.number()]),
    unit: z.string().optional(),
  })),
});

export const ChartSection = z.object({
  type: z.literal('chart'),
  chartType: z.enum(['bar', 'line', 'area']),
  xAxis: z.string(),
  yAxis: z.string(),
  data: z.array(z.record(z.union([z.string(), z.number()]))),
  caption: z.string().optional(),
  color: z.string().optional(),
  colors: z.array(z.string()).optional(),
  fillOpacity: z.number().optional(),
  height: z.number().optional(),
  theme: z.string().optional(),
}).passthrough();

export const VegaLiteSection = z.object({
  type: z.literal('vegalite'),
  spec: z.record(z.any()),   // full Vega-Lite JSON spec
  height: z.number().optional(),
  caption: z.string().optional(),
  theme: z.string().optional(),
});

export const ChartGridSection = z.object({
  type: z.literal('chart-grid'),
  columns: z.number().min(1).max(4).default(2),
  charts: z.array(z.union([
    z.object({ type: z.literal('chart') }).passthrough(),
    z.object({ type: z.literal('vegalite') }).passthrough(),
    z.object({ type: z.literal('embed') }).passthrough(),
  ])),
  caption: z.string().optional(),
});

export const EmbedSection = z.object({
  type: z.literal('embed'),
  html: z.string(),
  height: z.number().optional(),
  caption: z.string().optional(),
});

export const CardSection = z.discriminatedUnion('type', [
  SummarySection,
  NarrativeSection,
  MetricSection,
  TableSection,
  CalloutSection,
  MetricsRowSection,
  ChartSection,
  VegaLiteSection,
  ChartGridSection,
  EmbedSection,
]);

export type CardSectionType = z.infer<typeof CardSection>;

// ─── DataQuery Schema ────────────────────────────────────────────────────────
//
// INTENTIONALLY PERMISSIVE. The AI is smart and will invent reasonable
// operators/structures we haven't anticipated. The data-query executor
// handles unknown operators gracefully (falls back to "contains").
// Do NOT add strict enums here — they reject valid AI output.

export const DataQuerySchema = z.record(z.any()).optional();

export type DataQuery = Record<string, any> | undefined;

// ─── Analysis Card Content ───────────────────────────────────────────────────

export const AnalysisContentSchema = z.object({
  sections: z.array(CardSection),
  dataQuery: DataQuerySchema.optional(),
});

export type AnalysisContent = z.infer<typeof AnalysisContentSchema>;

// ─── Validation Helpers ──────────────────────────────────────────────────────

/**
 * Validate and filter sections — drops invalid ones instead of rejecting the whole card.
 * This is the "graceful degradation" approach for AI-generated content.
 */
export function validateSections(raw: unknown[]): CardSectionType[] {
  if (!Array.isArray(raw)) return [];
  const valid: CardSectionType[] = [];
  for (const item of raw) {
    // Normalize common AI type aliases before validation
    const normalized = normalizeSection(item);
    const result = CardSection.safeParse(normalized);
    if (result.success) {
      valid.push(result.data);
    } else {
      console.warn('[card-schema] Dropped invalid section:', item, result.error.issues);
    }
  }
  return valid;
}

/** Map AI-generated type aliases to canonical section types */
function normalizeSection(item: unknown): unknown {
  if (typeof item !== 'object' || item === null) return item;
  const s = item as Record<string, unknown>;
  // 'text' and 'paragraph' → 'narrative'
  if (s.type === 'text' || s.type === 'paragraph') {
    return { ...s, type: 'narrative', text: s.content ?? s.text ?? '' };
  }
  // 'header' → 'summary'
  if (s.type === 'header') {
    return { ...s, type: 'summary', text: s.content ?? s.text ?? '' };
  }
  // vegalite aliases — AI commonly uses 'vega', 'vega-lite', 'vegaLite'
  if (s.type === 'vega' || s.type === 'vega-lite' || s.type === 'vegaLite') {
    return { ...s, type: 'vegalite' };
  }
  // chart.chartType === 'heatmap' — recharts doesn't support heatmap.
  // Remap to a vegalite rect spec using the data the AI already prepared.
  if (s.type === 'chart' && s.chartType === 'heatmap') {
    return {
      type: 'vegalite',
      caption: s.caption,
      height: (s.height as number) || 320,
      spec: {
        $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
        mark: 'rect',
        encoding: {
          x: { field: s.xAxis as string || 'x', type: 'ordinal' },
          y: { field: s.yAxis as string || 'y', type: 'ordinal' },
          color: {
            field: (s.colorField as string) || (s.xAxis as string) || 'value',
            type: 'quantitative',
            scale: { scheme: 'orangered' },
          },
        },
        data: { values: (s.data as unknown[]) || [] },
      },
    };
  }
  // embed aliases — AI may say 'svg', 'html', 'html-embed'
  if (s.type === 'svg' || s.type === 'html' || s.type === 'html-embed') {
    return { ...s, type: 'embed' };
  }
  // chart-grid aliases
  if (s.type === 'grid' || s.type === 'chartgrid' || s.type === 'chart_grid') {
    return { ...s, type: 'chart-grid' };
  }
  return item;
}
