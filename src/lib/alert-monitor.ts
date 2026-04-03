/**
 * Alert Monitor — evaluates user-defined thresholds against the active dataset.
 *
 * Pure data comparison — no AI calls. Thresholds are stored as memories of
 * type 'threshold' in sherpa_memories. Content is a JSON string with shape:
 *   { column, operator, value, label, severity, aggregation? }
 *
 * Called on a 60-second interval from SherpaContext.
 */

export type AlertSeverity = 'info' | 'warning' | 'danger';

export interface AlertThreshold {
  id: string;
  column: string;
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq';
  value: number;
  label: string;
  severity: AlertSeverity;
  /** Optional: 'any' fires if any row meets condition; 'count' fires if count > 0; 'sum' fires based on sum */
  aggregation?: 'any' | 'count' | 'sum';
}

export interface AlertFiring {
  threshold: AlertThreshold;
  message: string;
  matchedRows: number;
  currentValue: number | null;
}

/**
 * Parse threshold memories from their JSON content string.
 * Gracefully skips malformed entries.
 */
export function parseThreshold(memoryContent: string): AlertThreshold | null {
  try {
    const parsed = JSON.parse(memoryContent) as Partial<AlertThreshold>;
    if (!parsed.column || !parsed.operator || parsed.value === undefined || !parsed.label) return null;
    return {
      id: parsed.id || '',
      column: parsed.column,
      operator: parsed.operator,
      value: Number(parsed.value),
      label: parsed.label,
      severity: parsed.severity ?? 'warning',
      aggregation: parsed.aggregation ?? 'any',
    };
  } catch {
    return null;
  }
}

function compareOp(num: number, op: AlertThreshold['operator'], value: number): boolean {
  switch (op) {
    case 'gt':  return num > value;
    case 'lt':  return num < value;
    case 'gte': return num >= value;
    case 'lte': return num <= value;
    case 'eq':  return num === value;
    case 'neq': return num !== value;
    default:    return false;
  }
}

/**
 * Evaluate a single threshold against a dataset.
 * Returns an AlertFiring if the condition is met, null otherwise.
 *
 * Aggregation semantics:
 *   'sum'   — sum the entire column, fire if total meets condition
 *   'count' — count rows individually meeting condition, fire if count > 0
 *   'any'   — fire if any individual row meets condition (same as count but reports match count)
 */
function evaluateThreshold(
  threshold: AlertThreshold,
  columns: string[],
  rows: string[][],
): AlertFiring | null {
  const colIdx = columns.findIndex(
    (c) => c.toLowerCase() === threshold.column.toLowerCase()
  );
  if (colIdx === -1) return null;

  const parseNum = (raw: unknown) => parseFloat(String(raw ?? '').replace(/[$,%\s]/g, ''));

  if (threshold.aggregation === 'sum') {
    // Sum ALL rows in the column, then compare the total
    const total = rows.reduce((acc, row) => {
      const num = parseNum(row[colIdx]);
      return acc + (isNaN(num) ? 0 : num);
    }, 0);
    if (!compareOp(total, threshold.operator, threshold.value)) return null;
    return {
      threshold,
      message: `${threshold.label}: $${total.toLocaleString()} total`,
      matchedRows: rows.length,
      currentValue: total,
    };
  }

  // 'any' and 'count' — filter rows that individually meet the condition
  const matchingRows = rows.filter((row) => {
    const num = parseNum(row[colIdx]);
    return !isNaN(num) && compareOp(num, threshold.operator, threshold.value);
  });

  if (matchingRows.length === 0) return null;

  if (threshold.aggregation === 'count') {
    return {
      threshold,
      message: `${threshold.label}: ${matchingRows.length} row${matchingRows.length !== 1 ? 's' : ''}`,
      matchedRows: matchingRows.length,
      currentValue: matchingRows.length,
    };
  }

  // 'any' default
  const firstNum = parseNum(matchingRows[0][colIdx]);
  return {
    threshold,
    message: `${threshold.label}: ${matchingRows.length} row${matchingRows.length !== 1 ? 's' : ''} match`,
    matchedRows: matchingRows.length,
    currentValue: isNaN(firstNum) ? null : firstNum,
  };
}

/**
 * Check all thresholds against the current dataset.
 * Returns only the thresholds that are currently firing.
 */
export function checkAlertThresholds(
  thresholds: AlertThreshold[],
  columns: string[],
  rows: string[][],
): AlertFiring[] {
  if (!thresholds.length || !rows.length) return [];
  return thresholds
    .map((t) => evaluateThreshold(t, columns, rows))
    .filter((f): f is AlertFiring => f !== null);
}
