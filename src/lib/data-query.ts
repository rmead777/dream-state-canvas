/**
 * DataQuery Executor — runs AI-generated data queries against the active dataset.
 *
 * Translates DataQuery schema (filter, sort, columns, limit, groupBy)
 * into actual data operations. Pure function — no state mutation, no API calls.
 *
 * This is a parallel path to data-slicer.ts, not a replacement.
 * The slicer handles DataProfile-driven deterministic views.
 * This handles AI-driven dynamic queries.
 */
import { getActiveDataset } from './active-dataset';
import type { DataQuery } from './card-schema';

export interface QueryResult {
  columns: string[];
  rows: (string | number | null)[][];
  totalMatched: number;
  truncated: boolean;
}

/**
 * Execute a DataQuery against a dataset.
 * If `_dataset` is provided in the query, uses that instead of the active dataset.
 * The `_dataset` field is a runtime-only override — not part of the AI-visible schema.
 */
export function executeDataQuery(query: DataQuery): QueryResult {
  const datasetOverride = (query as any)?._dataset as { columns: string[]; rows: string[][] } | undefined;
  const { columns: allColumns, rows: allRows } = datasetOverride ?? getActiveDataset();

  if (!query) {
    return { columns: allColumns, rows: allRows, totalMatched: allRows.length, truncated: false };
  }

  let rows: (string | number | null)[][] = [...allRows];

  // 1. Apply filters
  if (query.filter) {
    rows = applyFilter(rows, allColumns, query.filter);
  }
  if (query.filters) {
    for (const f of query.filters) {
      rows = applyFilter(rows, allColumns, f);
    }
  }

  // 2. Apply sort
  if (query.sort) {
    const colIdx = allColumns.indexOf(query.sort.column);
    if (colIdx >= 0) {
      const dir = query.sort.direction;
      rows.sort((a, b) => {
        const va = a[colIdx], vb = b[colIdx];
        const na = parseNumeric(String(va ?? '')), nb = parseNumeric(String(vb ?? ''));
        const bothNumeric = !isNaN(na) && !isNaN(nb);
        const cmp = bothNumeric ? na - nb : String(va ?? '').localeCompare(String(vb ?? ''), undefined, { numeric: true });
        return dir === 'desc' ? -cmp : cmp;
      });
    }
  }

  // 3. Select columns
  const selectedColumns = query.columns
    ? query.columns.filter(c => allColumns.includes(c))
    : allColumns;
  const colIndices = selectedColumns.map(c => allColumns.indexOf(c));

  const totalMatched = rows.length;

  // 4. Apply limit
  if (query.limit && query.limit > 0) {
    rows = rows.slice(0, query.limit);
  }

  // 5. Project columns
  const projected = rows.map(row => colIndices.map(i => row[i]));

  return {
    columns: selectedColumns,
    rows: projected,
    totalMatched,
    truncated: query.limit ? totalMatched > query.limit : false,
  };
}

function applyFilter(
  rows: (string | number | null)[][],
  columns: string[],
  filter: { column: string; operator?: string; value: string | number | (string | number)[] }
): (string | number | null)[][] {
  const colIdx = columns.indexOf(filter.column);
  if (colIdx < 0) return rows;

  const op = filter.operator || 'contains';
  return rows.filter(row => {
    const cell = row[colIdx];
    const cellStr = String(cell ?? '');
    const val = filter.value;

    switch (op) {
      case 'equals': return cellStr.toLowerCase() === String(val).toLowerCase();
      case 'contains': return cellStr.toLowerCase().includes(String(val).toLowerCase());
      case 'gt': return parseNumeric(cellStr) > Number(val);
      case 'lt': return parseNumeric(cellStr) < Number(val);
      case 'gte': return parseNumeric(cellStr) >= Number(val);
      case 'lte': return parseNumeric(cellStr) <= Number(val);
      case 'in': {
        // value is an array — check if cell matches any entry (case-insensitive, partial match)
        const values = Array.isArray(val) ? val : [val];
        const cellLower = cellStr.toLowerCase();
        return values.some(v => cellLower.includes(String(v).toLowerCase()));
      }
      case 'not': return !cellStr.toLowerCase().includes(String(val).toLowerCase());
      default: return true;
    }
  });
}

/** Parse currency/percentage strings into sortable numbers */
function parseNumeric(val: string): number {
  if (!val || val === '—' || val === '-') return 0;
  const cleaned = val.replace(/[$,%]/g, '').replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}
