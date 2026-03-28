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
 * Build ordinal rank lookup from profile.
 * Returns a Map from lowercase value → rank index (0 = highest priority).
 */
function buildRankMap(profile: DataProfile): Map<string, number> | null {
  if (!profile.ordinalPriorityColumn) return null;
  const map = new Map<string, number>();
  profile.ordinalPriorityColumn.rankOrder.forEach((val, idx) => {
    map.set(val.toLowerCase(), idx);
  });
  return map;
}

/**
 * Sort rows respecting ordinal priority first, then measure within each rank.
 */
function sortRows(
  rows: string[][],
  columns: string[],
  profile: DataProfile
): string[][] {
  const measureIdx = getColumnIndex(columns, profile.primaryMeasureColumn);
  const rankMap = buildRankMap(profile);

  if (rankMap && profile.ordinalPriorityColumn) {
    const prioIdx = getColumnIndex(columns, profile.ordinalPriorityColumn.column);
    return [...rows].sort((a, b) => {
      // Sort by ordinal priority rank first
      const rankA = rankMap.get(a[prioIdx]?.toLowerCase()) ?? 99;
      const rankB = rankMap.get(b[prioIdx]?.toLowerCase()) ?? 99;
      if (rankA !== rankB) return rankA - rankB;

      // Within same rank, sort by measure
      const va = parseNumeric(a[measureIdx]);
      const vb = parseNumeric(b[measureIdx]);
      return profile.sortDirection === 'desc' ? vb - va : va - vb;
    });
  }

  // No ordinal priority — use urgency boosting + measure sort
  if (profile.urgencySignal) {
    const urgencyIdx = getColumnIndex(columns, profile.urgencySignal.column);
    const hotSet = new Set(profile.urgencySignal.hotValues.map(v => v.toLowerCase()));

    const urgent = rows.filter(r => hotSet.has(r[urgencyIdx]?.toLowerCase()));
    const rest = rows.filter(r => !hotSet.has(r[urgencyIdx]?.toLowerCase()));

    const sortByMeasure = (a: string[], b: string[]) => {
      const va = parseNumeric(a[measureIdx]);
      const vb = parseNumeric(b[measureIdx]);
      return profile.sortDirection === 'desc' ? vb - va : va - vb;
    };

    urgent.sort(sortByMeasure);
    rest.sort(sortByMeasure);
    return [...urgent, ...rest];
  }

  return [...rows].sort((a, b) => {
    const va = parseNumeric(a[measureIdx]);
    const vb = parseNumeric(b[measureIdx]);
    return profile.sortDirection === 'desc' ? vb - va : va - vb;
  });
}

/**
 * Preview rows — top N sorted by ordinal priority then measure.
 */
export function previewRows(
  columns: string[],
  rows: string[][],
  profile: DataProfile,
  n: number = 8
): { columns: string[]; rows: string[][] } {
  const sorted = sortRows(rows, columns, profile);
  return { columns, rows: sorted.slice(0, n) };
}

/**
 * Alert rows — items matching urgency signal hot values OR top-ranked ordinal priority items.
 */
export function alertRows(
  columns: string[],
  rows: string[][],
  profile: DataProfile
): Array<{ id: string; severity: 'high' | 'medium' | 'low'; title: string; description: string; timestamp: number; actionable: boolean }> {
  const measureIdx = getColumnIndex(columns, profile.primaryMeasureColumn);
  const idIdx = getColumnIndex(columns, profile.primaryIdColumn);
  const rankMap = buildRankMap(profile);

  // If we have ordinal priority, use it for alert severity
  if (rankMap && profile.ordinalPriorityColumn) {
    const prioIdx = getColumnIndex(columns, profile.ordinalPriorityColumn.column);
    const topRanks = profile.ordinalPriorityColumn.rankOrder.slice(0, 2);
    const topSet = new Set(topRanks.map(v => v.toLowerCase()));

    return rows
      .filter(row => topSet.has(row[prioIdx]?.toLowerCase()))
      .sort((a, b) => {
        const ra = rankMap.get(a[prioIdx]?.toLowerCase()) ?? 99;
        const rb = rankMap.get(b[prioIdx]?.toLowerCase()) ?? 99;
        if (ra !== rb) return ra - rb;
        return parseNumeric(b[measureIdx]) - parseNumeric(a[measureIdx]);
      })
      .map((row, i) => {
        const rank = rankMap.get(row[prioIdx]?.toLowerCase()) ?? 99;
        const severity: 'high' | 'medium' | 'low' = rank === 0 ? 'high' : 'medium';
        return {
          id: `alert-${i}`,
          severity,
          title: `${row[idIdx]} — ${row[measureIdx]}`,
          description: `${row[prioIdx]}. ${columns.slice(3).map((c, j) => `${c}: ${row[j + 3]}`).slice(0, 2).join('. ')}.`,
          timestamp: Date.now() - (i * 86400000),
          actionable: rank === 0,
        };
      });
  }

  // Fallback: use urgencySignal
  if (profile.urgencySignal) {
    const urgencyIdx = getColumnIndex(columns, profile.urgencySignal.column);
    const hotSet = new Set(profile.urgencySignal.hotValues.map(v => v.toLowerCase()));
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

  // No priority info — top by measure
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

/**
 * Metric aggregate — sums the primary measure, broken down by group column.
 * If ordinal priority exists, breakdown is ordered by rank (not by value).
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

  const groupCol = profile.groupByColumn;
  const rankMap = buildRankMap(profile);

  if (groupCol) {
    const groupIdx = getColumnIndex(columns, groupCol);
    const groups = new Map<string, number>();

    for (const row of rows) {
      const group = row[groupIdx] || 'Other';
      groups.set(group, (groups.get(group) || 0) + parseNumeric(row[measureIdx]));
    }

    // If ordinal priority matches the group column, sort by rank order
    if (rankMap && profile.ordinalPriorityColumn?.column === groupCol) {
      breakdown = profile.ordinalPriorityColumn.rankOrder
        .filter(rank => groups.has(rank))
        .map(rank => ({ name: rank, value: groups.get(rank) || 0 }));
      // Add any groups not in rankOrder
      for (const [name, value] of groups) {
        if (!profile.ordinalPriorityColumn.rankOrder.includes(name)) {
          breakdown.push({ name, value });
        }
      }
    } else {
      breakdown = [...groups.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name, value }));
    }

    sparkline = breakdown.map(b => b.value);
    sparklineLabels = breakdown.map(b => b.name);
  }

  const strategy = profile.ordinalPriorityColumn
    ? `Rows prioritized by ${profile.ordinalPriorityColumn.column} rank (${profile.ordinalPriorityColumn.rankOrder[0]} first), then by ${profile.primaryMeasureColumn}.`
    : profile.previewStrategy;

  return {
    currentValue: total,
    unit: profile.measureFormat === 'currency' ? '$' : '',
    breakdown,
    sparkline,
    sparklineLabels,
    context: `Total ${profile.primaryMeasureColumn} across ${rows.length} items. ${strategy}`,
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

  // Use ordinal-priority-aware sorting
  const sorted = sortRows(rows, columns, profile);
  const nonZero = sorted.filter(r => parseNumeric(r[measureIdx]) > 0);

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
