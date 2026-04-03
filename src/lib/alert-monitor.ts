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

/**
 * Evaluate a single threshold against a dataset.
 * Returns an AlertFiring if the condition is met, null otherwise.
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

  const matchingRows = rows.filter((row) => {
    const raw = row[colIdx];
    const num = parseFloat(String(raw ?? '').replace(/[$,%\s]/g, ''));
    if (isNaN(num)) return false;

    switch (threshold.operator) {
      case 'gt':  return num > threshold.value;
      case 'lt':  return num < threshold.value;
      case 'gte': return num >= threshold.value;
      case 'lte': return num <= threshold.value;
      case 'eq':  return num === threshold.value;
      case 'neq': return num !== threshold.value;
      default:    return false;
    }
  });

  if (matchingRows.length === 0) return null;

  let currentValue: number | null = null;
  let message = threshold.label;

  if (threshold.aggregation === 'sum') {
    currentValue = matchingRows.reduce((sum, row) => {
      const num = parseFloat(String(row[colIdx] ?? '').replace(/[$,%\s]/g, ''));
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
    message = `${threshold.label}: $${currentValue.toLocaleString()} (${matchingRows.length} rows)`;
  } else if (threshold.aggregation === 'count') {
    currentValue = matchingRows.length;
    message = `${threshold.label}: ${matchingRows.length} rows`;
  } else {
    // 'any' — just report first matching value
    const rawFirst = matchingRows[0][colIdx];
    const numFirst = parseFloat(String(rawFirst ?? '').replace(/[$,%\s]/g, ''));
    currentValue = isNaN(numFirst) ? null : numFirst;
    message = `${threshold.label}: ${matchingRows.length} row${matchingRows.length !== 1 ? 's' : ''} match`;
  }

  return { threshold, message, matchedRows: matchingRows.length, currentValue };
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
