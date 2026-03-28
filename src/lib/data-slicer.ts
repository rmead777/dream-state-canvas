import { DataProfile } from './data-analyzer';

/**
 * Pure, deterministic functions that derive preview subsets from a full dataset
 * using the AI-generated DataProfile. Domain-agnostic — works with any data shape.
 *
 * PRIORITY DISCIPLINE:
 * 1. If ordinalPriorityColumn exists, rows are ALWAYS sorted by rank first.
 * 2. Within each rank, sorting depends on operational meaning:
 *    - Action tiers (rank 0-1, keywords: "act now", "urgent", "critical") → sort by deadline proximity (Days Silent ascending = most overdue first)
 *    - Monitoring tiers (rank 2+, keywords: "monitor", "watch") → sort by exposure magnitude (measure descending)
 *    - Ambiguous → sort by recency (Days Silent ascending)
 * 3. AI never silently re-ranks away from explicit priorities.
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
 * Classify a tier's operational meaning based on its label.
 */
type TierMeaning = 'action' | 'monitoring' | 'ambiguous';

function classifyTier(tierLabel: string): TierMeaning {
  const lower = tierLabel.toLowerCase();
  if (/act now|urgent|critical|immediate|unblock|escalat/i.test(lower)) return 'action';
  if (/monitor|watch|review|track|observe/i.test(lower)) return 'monitoring';
  return 'ambiguous';
}

/**
 * Detect a "deadline proximity" column — Days Silent, Days Overdue, etc.
 */
function findDeadlineColumn(columns: string[]): number {
  for (let i = 0; i < columns.length; i++) {
    if (/days?\s*(silent|overdue|late|past|due|remaining|aging)/i.test(columns[i])) return i;
  }
  // Fallback: any column with "days" or "deadline" or "date"
  for (let i = 0; i < columns.length; i++) {
    if (/day|deadline|date|age/i.test(columns[i])) return i;
  }
  return -1;
}

/**
 * Sort rows respecting ordinal priority first, then within-tier operational sorting.
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
    const deadlineIdx = findDeadlineColumn(columns);

    // Pre-classify each rank value's operational meaning
    const tierMeanings = new Map<string, TierMeaning>();
    for (const rank of profile.ordinalPriorityColumn.rankOrder) {
      tierMeanings.set(rank.toLowerCase(), classifyTier(rank));
    }

    return [...rows].sort((a, b) => {
      // 1. Sort by ordinal priority rank first — NEVER violated
      const rankA = rankMap.get(a[prioIdx]?.toLowerCase()) ?? 99;
      const rankB = rankMap.get(b[prioIdx]?.toLowerCase()) ?? 99;
      if (rankA !== rankB) return rankA - rankB;

      // 2. Within same rank, sort by operational meaning
      const meaning = tierMeanings.get(a[prioIdx]?.toLowerCase()) ?? 'ambiguous';

      switch (meaning) {
        case 'action': {
          // Action tiers: sort by deadline proximity (Days Silent desc = most overdue first)
          if (deadlineIdx >= 0) {
            const da = parseNumeric(a[deadlineIdx]);
            const db = parseNumeric(b[deadlineIdx]);
            if (da !== db) return db - da; // More days silent = more urgent
          }
          // Tiebreak by measure
          return parseNumeric(b[measureIdx]) - parseNumeric(a[measureIdx]);
        }
        case 'monitoring': {
          // Monitoring tiers: sort by exposure magnitude
          const va = parseNumeric(a[measureIdx]);
          const vb = parseNumeric(b[measureIdx]);
          return profile.sortDirection === 'desc' ? vb - va : va - vb;
        }
        default: {
          // Ambiguous: sort by recency (Days Silent ascending = recently active first)
          if (deadlineIdx >= 0) {
            const da = parseNumeric(a[deadlineIdx]);
            const db = parseNumeric(b[deadlineIdx]);
            if (da !== db) return da - db;
          }
          return parseNumeric(b[measureIdx]) - parseNumeric(a[measureIdx]);
        }
      }
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
 * Preview rows — top N sorted by ordinal priority then within-tier logic.
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
 * Alert rows — items matching top-ranked ordinal priority items or urgency signals.
 */
export function alertRows(
  columns: string[],
  rows: string[][],
  profile: DataProfile
): Array<{ id: string; severity: 'high' | 'medium' | 'low'; title: string; description: string; timestamp: number; actionable: boolean }> {
  const measureIdx = getColumnIndex(columns, profile.primaryMeasureColumn);
  const idIdx = getColumnIndex(columns, profile.primaryIdColumn);
  const rankMap = buildRankMap(profile);

  if (rankMap && profile.ordinalPriorityColumn) {
    const prioIdx = getColumnIndex(columns, profile.ordinalPriorityColumn.column);
    const topRanks = profile.ordinalPriorityColumn.rankOrder.slice(0, 2);
    const topSet = new Set(topRanks.map(v => v.toLowerCase()));

    // Sort within tiers using the full sortRows logic
    const filtered = rows.filter(row => topSet.has(row[prioIdx]?.toLowerCase()));
    const sorted = sortRows(filtered, columns, profile);

    return sorted.map((row, i) => {
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
 * Breakdown ordered by rank (not by value) when ordinal priority exists.
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

  if (groupCol) {
    const groupIdx = getColumnIndex(columns, groupCol);
    const groups = new Map<string, number>();

    for (const row of rows) {
      const group = row[groupIdx] || 'Other';
      groups.set(group, (groups.get(group) || 0) + parseNumeric(row[measureIdx]));
    }

    // If ordinal priority matches the group column, sort by rank order
    if (profile.ordinalPriorityColumn?.column === groupCol) {
      breakdown = profile.ordinalPriorityColumn.rankOrder
        .filter(rank => groups.has(rank))
        .map(rank => ({ name: rank, value: groups.get(rank) || 0 }));
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
    ? `Rows prioritized by ${profile.ordinalPriorityColumn.column} rank (${profile.ordinalPriorityColumn.rankOrder[0]} first). Within action tiers: sorted by deadline proximity. Within monitoring tiers: sorted by exposure magnitude.`
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

  const buildMetrics = (row: string[]): Record<string, string> => {
    const metrics: Record<string, string> = {};
    columns.forEach((col, i) => { metrics[col] = row[i]; });
    return metrics;
  };

  // When ordinal priority exists, compare the TOP entity from two different tiers
  // This ensures we contrast across risk categories, not pick arbitrary midpoints
  if (profile.ordinalPriorityColumn) {
    const prioIdx = getColumnIndex(columns, profile.ordinalPriorityColumn.column);
    const rankOrder = profile.ordinalPriorityColumn.rankOrder;

    // Group rows by tier, sorted within each tier
    const tierBuckets = new Map<string, string[][]>();
    for (const rank of rankOrder) {
      tierBuckets.set(rank.toLowerCase(), []);
    }
    for (const row of rows) {
      const tier = row[prioIdx]?.toLowerCase() || '';
      const bucket = tierBuckets.get(tier);
      if (bucket) bucket.push(row);
    }

    // Sort each bucket by measure (descending) to find the top entity per tier
    for (const [, bucket] of tierBuckets) {
      bucket.sort((a, b) => parseNumeric(b[measureIdx]) - parseNumeric(a[measureIdx]));
    }

    // Pick top entity from the two highest-priority tiers that have data
    const pickedRows: string[][] = [];
    for (const rank of rankOrder) {
      const bucket = tierBuckets.get(rank.toLowerCase());
      if (bucket && bucket.length > 0 && pickedRows.length < 2) {
        pickedRows.push(bucket[0]);
      }
    }

    // Fallback: if only one tier has data, pick top two from that tier
    if (pickedRows.length < 2) {
      for (const rank of rankOrder) {
        const bucket = tierBuckets.get(rank.toLowerCase());
        if (bucket && bucket.length >= 2 && pickedRows.length < 2) {
          if (pickedRows.length === 0) pickedRows.push(bucket[0]);
          pickedRows.push(bucket[1]);
        }
      }
    }

    if (pickedRows.length >= 2) {
      const [a, b] = pickedRows;
      return {
        entities: [
          { name: a[idIdx], metrics: buildMetrics(a) },
          { name: b[idIdx], metrics: buildMetrics(b) },
        ],
        highlights: [
          {
            metric: profile.ordinalPriorityColumn.column,
            insight: `${a[idIdx]} (${a[prioIdx]}) vs ${b[idIdx]} (${b[prioIdx]}) — contrasting across risk tiers`,
          },
          {
            metric: profile.primaryMeasureColumn,
            insight: `${a[idIdx]} at ${a[measureIdx]} vs ${b[idIdx]} at ${b[measureIdx]}`,
          },
        ],
      };
    }
  }

  // Fallback: no ordinal priority — pick highest vs second-highest by measure
  const sorted = sortRows(rows, columns, profile);
  const nonZero = sorted.filter(r => parseNumeric(r[measureIdx]) > 0);
  const top = nonZero[0];
  const second = nonZero[1] || nonZero[0];

  if (!top || !second) {
    return { entities: [], highlights: [] };
  }

  return {
    entities: [
      { name: top[idIdx], metrics: buildMetrics(top) },
      { name: second[idIdx], metrics: buildMetrics(second) },
    ],
    highlights: [
      { metric: profile.primaryMeasureColumn, insight: `${top[idIdx]} leads at ${top[measureIdx]} vs ${second[idIdx]} at ${second[measureIdx]}` },
    ],
  };
}

/**
 * Cross-tier anomaly detection — finds cases where lower-priority tiers
 * have disproportionate exposure vs higher-priority ones.
 * Returns insight strings to surface via Sherpa observations, NEVER re-rankings.
 */
export function detectCrossTierAnomalies(
  columns: string[],
  rows: string[][],
  profile: DataProfile
): string[] {
  if (!profile.ordinalPriorityColumn || !profile.groupByColumn) return [];

  const measureIdx = getColumnIndex(columns, profile.primaryMeasureColumn);
  const groupIdx = getColumnIndex(columns, profile.groupByColumn);
  const unit = profile.measureFormat === 'currency' ? '$' : '';

  // Aggregate by tier
  const tierTotals = new Map<string, number>();
  const tierCounts = new Map<string, number>();
  for (const row of rows) {
    const tier = row[groupIdx] || 'Other';
    tierTotals.set(tier, (tierTotals.get(tier) || 0) + parseNumeric(row[measureIdx]));
    tierCounts.set(tier, (tierCounts.get(tier) || 0) + 1);
  }

  const anomalies: string[] = [];
  const rankOrder = profile.ordinalPriorityColumn.rankOrder;

  // Compare each high-priority tier vs lower-priority tiers
  for (let i = 0; i < rankOrder.length - 1; i++) {
    const highTier = rankOrder[i];
    const highTotal = tierTotals.get(highTier) || 0;

    for (let j = i + 1; j < rankOrder.length; j++) {
      const lowTier = rankOrder[j];
      const lowTotal = tierTotals.get(lowTier) || 0;

      if (lowTotal > highTotal * 3 && highTotal > 0) {
        const ratio = Math.round(lowTotal / highTotal);
        const formatVal = (v: number) =>
          unit === '$'
            ? v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${(v / 1000).toFixed(0)}K`
            : v.toLocaleString();

        anomalies.push(
          `NOTICED: ${lowTier} aggregate (${formatVal(lowTotal)}) exceeds ${highTier} (${formatVal(highTotal)}) by ${ratio}x. The ${tierCounts.get(lowTier) || 0} vendors in ${lowTier} carry more total exposure than the ${tierCounts.get(highTier) || 0} urgent vendors. Worth reviewing whether any should be escalated?`
        );
      }
    }
  }

  return anomalies;
}

/**
 * Generate a human-readable explanation of the ranking logic being applied.
 * Used when no priority structure exists to inform the user.
 */
export function describeRankingLogic(profile: DataProfile): string {
  if (profile.ordinalPriorityColumn) {
    const tiers = profile.ordinalPriorityColumn.rankOrder;
    return `Data is sorted by the "${profile.ordinalPriorityColumn.column}" column: ${tiers.join(' → ')}. Within action tiers, items are sorted by deadline proximity. Within monitoring tiers, items are sorted by ${profile.primaryMeasureColumn} (${profile.sortDirection === 'desc' ? 'highest first' : 'lowest first'}).`;
  }

  if (profile.urgencySignal) {
    return `No explicit priority column found. Items flagged as ${profile.urgencySignal.hotValues.join(', ')} are shown first, then sorted by ${profile.primaryMeasureColumn} (${profile.sortDirection === 'desc' ? 'highest first' : 'lowest first'}). This is an AI-proposed ranking — you can define your own priority framework.`;
  }

  return `No priority structure detected in this dataset. Items are sorted by ${profile.primaryMeasureColumn} (${profile.sortDirection === 'desc' ? 'highest first' : 'lowest first'}). This is a provisional ranking — would you like to define which column represents priority?`;
}
