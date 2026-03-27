import { DataProfile } from './data-analyzer';

/**
 * Pure, deterministic functions that derive preview subsets from a full dataset
 * using the AI-generated DataProfile. Domain-agnostic — works with any data shape.
 */

// Parse a formatted number string like "$523,216" or "45%" into a sortable number
function parseNumeric(val: string): number {
  if (!val || val === '—' || val === '-') return 0;
  const cleaned = val.replace(/[$,%]/g, '').replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function getColumnIndex(columns: string[], colName: string): number {
  const idx = columns.indexOf(colName);
  return idx >= 0 ? idx : 0;
}

/**
 * Preview rows — top N by the primary measure, with urgency-flagged items boosted to the top.
 */
export function previewRows(
  columns: string[],
  rows: string[][],
  profile: DataProfile,
  n: number = 8
): { columns: string[]; rows: string[][] } {
  const measureIdx = getColumnIndex(columns, profile.primaryMeasureColumn);

  let sorted: string[][];

  if (profile.urgencySignal) {
    const urgencyIdx = getColumnIndex(columns, profile.urgencySignal.column);
    const hotSet = new Set(profile.urgencySignal.hotValues.map(v => v.toLowerCase()));

    // Partition: urgent items first, then by measure
    const urgent = rows.filter(r => hotSet.has(r[urgencyIdx]?.toLowerCase()));
    const rest = rows.filter(r => !hotSet.has(r[urgencyIdx]?.toLowerCase()));

    const sortByMeasure = (a: string[], b: string[]) => {
      const va = parseNumeric(a[measureIdx]);
      const vb = parseNumeric(b[measureIdx]);
      return profile.sortDirection === 'desc' ? vb - va : va - vb;
    };

    urgent.sort(sortByMeasure);
    rest.sort(sortByMeasure);
    sorted = [...urgent, ...rest];
  } else {
    sorted = [...rows].sort((a, b) => {
      const va = parseNumeric(a[measureIdx]);
      const vb = parseNumeric(b[measureIdx]);
      return profile.sortDirection === 'desc' ? vb - va : va - vb;
    });
  }

  return { columns, rows: sorted.slice(0, n) };
}

/**
 * Alert rows — items matching urgency signal hot values, sorted by measure.
 */
export function alertRows(
  columns: string[],
  rows: string[][],
  profile: DataProfile
): Array<{ id: string; severity: 'high' | 'medium' | 'low'; title: string; description: string; timestamp: number; actionable: boolean }> {
  if (!profile.urgencySignal) {
    // No urgency signal — take top items by measure as medium alerts
    const measureIdx = getColumnIndex(columns, profile.primaryMeasureColumn);
    const idIdx = getColumnIndex(columns, profile.primaryIdColumn);
    return [...rows]
      .sort((a, b) => parseNumeric(b[measureIdx]) - parseNumeric(a[measureIdx]))
      .slice(0, 5)
      .map((row, i) => ({
        id: `alert-${i}`,
        severity: 'medium' as const,
        title: `${row[idIdx]} — ${row[measureIdx]}`,
        description: `Top item by ${profile.primaryMeasureColumn}. Review recommended.`,
        timestamp: Date.now() - (i * 86400000),
        actionable: true,
      }));
  }

  const urgencyIdx = getColumnIndex(columns, profile.urgencySignal.column);
  const measureIdx = getColumnIndex(columns, profile.primaryMeasureColumn);
  const idIdx = getColumnIndex(columns, profile.primaryIdColumn);
  const hotSet = new Set(profile.urgencySignal.hotValues.map(v => v.toLowerCase()));

  // Classify severity based on hot value ordering (first = most urgent)
  const hotRank = new Map(profile.urgencySignal.hotValues.map((v, i) => [v.toLowerCase(), i]));

  return rows
    .filter(row => hotSet.has(row[urgencyIdx]?.toLowerCase()))
    .sort((a, b) => {
      const ra = hotRank.get(a[urgencyIdx]?.toLowerCase()) ?? 99;
      const rb = hotRank.get(b[urgencyIdx]?.toLowerCase()) ?? 99;
      if (ra !== rb) return ra - rb;
      return parseNumeric(b[measureIdx]) - parseNumeric(a[measureIdx]);
    })
    .map((row, i) => {
      const rank = hotRank.get(row[urgencyIdx]?.toLowerCase()) ?? 99;
      const severity: 'high' | 'medium' | 'low' = rank === 0 ? 'high' : rank === 1 ? 'medium' : 'low';
      return {
        id: `alert-${i}`,
        severity,
        title: `${row[idIdx]} — ${row[measureIdx]}`,
        description: `${row[urgencyIdx]}. ${columns.slice(3).map((c, j) => `${c}: ${row[j + 3]}`).slice(0, 2).join('. ')}.`,
        timestamp: Date.now() - (i * 86400000),
        actionable: severity !== 'low',
      };
    });
}

/**
 * Metric aggregate — sums the primary measure, broken down by group column.
 */
export function metricAggregate(
  columns: string[],
  rows: string[][],
  profile: DataProfile
): { currentValue: number; unit: string; breakdown: Array<{ name: string; value: number }>; sparkline: number[]; sparklineLabels: string[]; context: string } {
  const measureIdx = getColumnIndex(columns, profile.primaryMeasureColumn);
  const total = rows.reduce((sum, row) => sum + parseNumeric(row[measureIdx]), 0);

  let breakdown: Array<{ name: string; value: number }> = [];
  let sparkline: number[] = [];
  let sparklineLabels: string[] = [];

  if (profile.groupByColumn) {
    const groupIdx = getColumnIndex(columns, profile.groupByColumn);
    const groups = new Map<string, number>();

    for (const row of rows) {
      const group = row[groupIdx] || 'Other';
      groups.set(group, (groups.get(group) || 0) + parseNumeric(row[measureIdx]));
    }

    breakdown = [...groups.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));

    sparkline = breakdown.map(b => b.value);
    sparklineLabels = breakdown.map(b => b.name);
  }

  return {
    currentValue: total,
    unit: profile.measureFormat === 'currency' ? '$' : '',
    breakdown,
    sparkline,
    sparklineLabels,
    context: `Total ${profile.primaryMeasureColumn} across ${rows.length} items. ${profile.previewStrategy}`,
  };
}

/**
 * Comparison pairs — picks two contrasting entities for side-by-side comparison.
 */
export function comparisonPairs(
  columns: string[],
  rows: string[][],
  profile: DataProfile
): { entities: Array<{ name: string; metrics: Record<string, string> }>; highlights: Array<{ metric: string; insight: string }> } {
  const measureIdx = getColumnIndex(columns, profile.primaryMeasureColumn);
  const idIdx = getColumnIndex(columns, profile.primaryIdColumn);

  const sorted = [...rows].sort((a, b) => parseNumeric(b[measureIdx]) - parseNumeric(a[measureIdx]));
  const nonZero = sorted.filter(r => parseNumeric(r[measureIdx]) > 0);

  // Pick highest and a mid-range entity for contrast
  const top = nonZero[0];
  const mid = nonZero[Math.floor(nonZero.length / 2)] || nonZero[1] || nonZero[0];

  if (!top || !mid) {
    return { entities: [], highlights: [] };
  }

  const buildMetrics = (row: string[]): Record<string, string> => {
    const metrics: Record<string, string> = {};
    columns.forEach((col, i) => { metrics[col] = row[i]; });
    return metrics;
  };

  return {
    entities: [
      { name: top[idIdx], metrics: buildMetrics(top) },
      { name: mid[idIdx], metrics: buildMetrics(mid) },
    ],
    highlights: [
      { metric: profile.primaryMeasureColumn, insight: `${top[idIdx]} leads at ${top[measureIdx]} vs ${mid[idIdx]} at ${mid[measureIdx]}` },
    ],
  };
}
