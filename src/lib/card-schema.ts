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
});

export const CardSection = z.discriminatedUnion('type', [
  SummarySection,
  NarrativeSection,
  MetricSection,
  TableSection,
  CalloutSection,
  MetricsRowSection,
  ChartSection,
]);

export type CardSectionType = z.infer<typeof CardSection>;

// ─── DataQuery Schema ────────────────────────────────────────────────────────

const FilterSchema = z.object({
  column: z.string(),
  operator: z.enum(['equals', 'contains', 'gt', 'lt', 'gte', 'lte', 'in', 'not']).default('contains'),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]),
});

export const DataQuerySchema = z.object({
  filter: FilterSchema.optional(),
  filters: z.array(FilterSchema).optional(),
  columns: z.array(z.string()).optional(),
  sort: z.object({
    column: z.string(),
    direction: z.enum(['asc', 'desc']),
  }).optional(),
  limit: z.number().optional(),
  groupBy: z.string().optional(),
}).optional();

export type DataQuery = z.infer<typeof DataQuerySchema>;

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
    const result = CardSection.safeParse(item);
    if (result.success) {
      valid.push(result.data);
    } else {
      console.warn('[card-schema] Dropped invalid section:', item, result.error.issues);
    }
  }
  return valid;
}
