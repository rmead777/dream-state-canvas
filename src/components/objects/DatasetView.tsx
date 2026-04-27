import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Columns, Plus, Trash2, Save, Undo2 } from 'lucide-react';
import { WorkspaceObject } from '@/lib/workspace-types';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useDocuments } from '@/contexts/DocumentContext';
import { useAI } from '@/hooks/useAI';
import MarkdownRenderer from '@/components/objects/MarkdownRenderer';
import { getDisplayColumns, filterRowToColumns } from '@/lib/smart-columns';
import { getObjectViewState } from '@/lib/workspace-intelligence';
import { extractDataset } from '@/lib/document-store';
import { TableVisualization } from './TableVisualization';

interface DatasetViewProps {
  object: WorkspaceObject;
  isImmersive?: boolean;
}

type SortDir = 'asc' | 'desc' | null;
type EditingCell = { rowIdx: number; colIdx: number } | null;

type InferredType = 'date' | 'numeric' | 'numeric-sparse' | 'currency' | 'text' | 'empty';

/**
 * Convert an Excel/Sheets date serial to YYYY-MM-DD. Excel epoch is 1900-01-01,
 * UNIX epoch is 1970-01-01 → offset of 25569 days. Returns null if not a plausible serial.
 */
function excelSerialToISO(value: string): string | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 20000 || num > 80000) return null; // ~1954–2118
  const ms = Math.round((num - 25569) * 86400 * 1000);
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function inferColumnTypes(cols: string[], rows: string[][]): InferredType[] {
  const SAMPLE = Math.min(80, rows.length);
  return cols.map((col, i) => {
    const sample: string[] = [];
    for (let r = 0; r < SAMPLE; r++) {
      const v = rows[r]?.[i];
      if (v != null && String(v).trim() !== '') sample.push(String(v));
    }
    if (sample.length === 0) return 'empty';
    const looksLikeDateName = /\bdate\b|\bday\b|\btime\b|when|requested|delivery|shipped|due|created|start|end/i.test(col);
    const inSerialRange = sample.every(v => {
      const n = Number(v);
      return Number.isFinite(n) && n > 30000 && n < 80000;
    });
    if (looksLikeDateName && inSerialRange) return 'date';
    const allCurrency = sample.every(v => /^\$?-?[\d,]+(\.\d+)?$/.test(v.trim()) && /\$/.test(v));
    if (allCurrency) return 'currency';
    const allNumeric = sample.every(v => Number.isFinite(Number(v)));
    if (allNumeric) {
      const zeros = sample.filter(v => Number(v) === 0).length;
      if (zeros / sample.length > 0.6) return 'numeric-sparse';
      return 'numeric';
    }
    return 'text';
  });
}

export function DatasetView({ object, isImmersive = false }: DatasetViewProps) {
  const { dispatch } = useWorkspace();
  const { updateActiveDataset } = useDocuments();
  const { streamChat, isStreaming } = useAI();
  const d = object.context;
  const persistedView = getObjectViewState(d);

  // Cards use their own data. If columns/rows are missing but structured_data
  // exists (cards created before the active-dataset refactor), extract inline.
  const extracted = useMemo(() => {
    if (d.columns?.length > 0) return null; // already has data
    if (d.structured_data) return extractDataset({ structured_data: d.structured_data, metadata: d } as any);
    return null;
  }, [d.columns, d.structured_data]);

  const allColumns = useMemo<string[]>(
    () => d.columns || extracted?.columns || [],
    [d.columns, extracted]
  );
  const sourceRows = useMemo<string[][]>(
    () => d.rows || extracted?.rows || [],
    [d.rows, extracted]
  );

  // Editable state — only used in immersive mode
  const [editableRows, setEditableRows] = useState<string[][]>(() => sourceRows.map(r => [...r]));
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  // Sync editable rows when source changes externally (new upload, AI update)
  useEffect(() => {
    if (!hasChanges) {
      setEditableRows(sourceRows.map(r => [...r]));
    }
  }, [sourceRows, hasChanges]);

  const rawRows = isImmersive ? editableRows : sourceRows;

  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [filterText, setFilterText] = useState('');
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [showAllCols, setShowAllCols] = useState(isImmersive);
  const showInsightCard = isStreaming || Boolean(aiInsight);

  const smartCols = useMemo(() => {
    const preferred = (persistedView.preferredColumns || []).filter((column) => allColumns.includes(column));
    return preferred.length > 0 ? preferred : getDisplayColumns(allColumns, rawRows);
  }, [allColumns, rawRows, persistedView.preferredColumns]);
  const needsExpand = allColumns.length > smartCols.length;
  const visibleCols = showAllCols ? allColumns : smartCols;

  const handleSort = (colIdx: number) => {
    if (sortCol === colIdx) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc'));
      if (sortDir === 'desc') setSortCol(null);
    } else {
      setSortCol(colIdx);
      setSortDir('asc');
    }
  };

  // Map from filtered/sorted index back to editable row index
  const filteredAndSortedWithIndex = useMemo(() => {
    let indexed = rawRows.map((row, originalIdx) => ({ row, originalIdx }));
    if (filterText) {
      const lower = filterText.toLowerCase();
      indexed = indexed.filter(({ row }) => row.some((c) => c.toLowerCase().includes(lower)));
    }
    if (sortCol !== null && sortDir) {
      const realIdx = allColumns.indexOf(visibleCols[sortCol]);
      if (realIdx >= 0) {
        indexed = [...indexed].sort((a, b) => {
          const av = a.row[realIdx] ?? '';
          const bv = b.row[realIdx] ?? '';
          const cmp = av.localeCompare(bv, undefined, { numeric: true });
          return sortDir === 'asc' ? cmp : -cmp;
        });
      }
    }
    return indexed;
  }, [rawRows, sortCol, sortDir, filterText, allColumns, visibleCols]);

  const filteredAndSorted = useMemo(
    () => filteredAndSortedWithIndex.map(({ row }) => row),
    [filteredAndSortedWithIndex]
  );

  const getVisibleRow = useCallback(
    (row: string[]) => (showAllCols ? row : filterRowToColumns(row, allColumns, smartCols)),
    [showAllCols, allColumns, smartCols]
  );

  // ─── Edit handlers ──────────────────────────────────────────────────────────

  const handleCellEdit = useCallback((displayRowIdx: number, visibleColIdx: number, value: string) => {
    const originalRowIdx = filteredAndSortedWithIndex[displayRowIdx]?.originalIdx;
    if (originalRowIdx == null) return;
    const realColIdx = allColumns.indexOf(visibleCols[visibleColIdx]);
    if (realColIdx < 0) return;

    setEditableRows(prev => {
      const next = prev.map(r => [...r]);
      next[originalRowIdx][realColIdx] = value;
      return next;
    });
    setHasChanges(true);
    setEditingCell(null);
  }, [filteredAndSortedWithIndex, allColumns, visibleCols]);

  const handleAddRow = useCallback(() => {
    setEditableRows(prev => [...prev, allColumns.map(() => '')]);
    setHasChanges(true);
  }, [allColumns]);

  const handleDeleteRows = useCallback(() => {
    if (selectedRows.size === 0) return;
    // Convert display indices to original indices
    const originalIndices = new Set<number>();
    selectedRows.forEach(displayIdx => {
      const orig = filteredAndSortedWithIndex[displayIdx]?.originalIdx;
      if (orig != null) originalIndices.add(orig);
    });
    setEditableRows(prev => prev.filter((_, i) => !originalIndices.has(i)));
    setSelectedRows(new Set());
    setHasChanges(true);
  }, [selectedRows, filteredAndSortedWithIndex]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    const success = await updateActiveDataset(allColumns, editableRows);
    setIsSaving(false);
    if (success) {
      setHasChanges(false);
      setSelectedRows(new Set());
      // Also update the workspace object's context so it stays in sync
      dispatch({
        type: 'UPDATE_OBJECT_CONTEXT',
        payload: { id: object.id, context: { ...d, columns: allColumns, rows: editableRows } },
      });
    }
  }, [allColumns, editableRows, updateActiveDataset, dispatch, object.id, d]);

  const handleDiscard = useCallback(() => {
    setEditableRows(sourceRows.map(r => [...r]));
    setHasChanges(false);
    setSelectedRows(new Set());
    setEditingCell(null);
  }, [sourceRows]);

  const handleToggleRow = useCallback((displayIdx: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(displayIdx)) next.delete(displayIdx);
      else next.add(displayIdx);
      return next;
    });
  }, []);

  const handleGenerateInsight = useCallback(async () => {
    if (isStreaming) return;
    setAiInsight('');

    const columnTypes = inferColumnTypes(allColumns, rawRows);

    // Inline-convert Excel date serials so the model reads real dates, not opaque numbers
    const formattedRows = rawRows.map((row) =>
      row.map((cell, colIdx) => {
        if (columnTypes[colIdx] === 'date') {
          const iso = excelSerialToISO(String(cell));
          return iso ?? String(cell);
        }
        return String(cell);
      })
    );

    const schemaLines = allColumns
      .map((col, i) => `  ${i + 1}. "${col}" — ${columnTypes[i]}`)
      .join('\n');

    const tableStr = [
      allColumns.join(' | '),
      ...formattedRows.map((r) => r.join(' | ')),
    ].join('\n');

    const datasetName = object.title || 'this dataset';

    const prompt = `Analyze the dataset below and surface 3–5 key insights.

Dataset: ${datasetName}
Rows: ${rawRows.length} · Columns: ${allColumns.length}

Schema (column → inferred type):
${schemaLines}

Notes:
- Date columns have already been converted from Excel serials to YYYY-MM-DD.
- "numeric-sparse" columns are mostly zero — likely pivot/category columns where non-zero rows are the signal.

Data (pipe-delimited, all rows):
${tableStr}

Look for: meaningful patterns, time trends, outliers, top entities, anomalies, or operational risks. Cite specific values, dates, and entity names. Skip surface-level observations like "the dataset has N rows."`;

    await streamChat(
      [{ role: 'user', content: prompt }],
      { mode: 'dataset', onDelta: (text) => setAiInsight((prev) => (prev || '') + text) }
    );
  }, [isStreaming, streamChat, allColumns, rawRows, object.title]);

  const handleEnterImmersive = () => {
    dispatch({ type: 'ENTER_IMMERSIVE', payload: { id: object.id } });
  };

  /* ── Compact preview (non-immersive) ── */
  if (!isImmersive) {
    const previewCols = smartCols.slice(0, 4);
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="workspace-pill rounded-full px-3 py-1.5 text-xs text-workspace-text-secondary tabular-nums">
            {rawRows.length} rows · {allColumns.length} columns
          </span>
          <button
            onClick={handleEnterImmersive}
            className="workspace-focus-ring rounded-full px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-workspace-accent transition-colors hover:bg-workspace-accent-subtle/30"
          >
            Expand dataset →
          </button>
        </div>
        {persistedView.displayMode === 'chart' ? (
          <TableVisualization columns={allColumns} rows={rawRows} view={persistedView} title={object.title} />
        ) : (
          <div className="workspace-card-surface overflow-hidden rounded-2xl border border-workspace-border/45">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-workspace-border bg-workspace-surface/40">
                  {previewCols.map((col, idx) => (
                    <th key={`${idx}-${col}`} className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.18em] text-workspace-text-secondary whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                  {allColumns.length > 4 && (
                    <th className="px-4 py-2.5 text-left text-workspace-text-secondary/40 tabular-nums">+{allColumns.length - 4}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rawRows.slice(0, object.context?.dataQuery?.limit ?? (object.context?.queryMeta ? rawRows.length : 3)).map((row, i) => {
                  const cells = filterRowToColumns(row, allColumns, previewCols);
                  return (
                    <tr key={i} className={i < 2 ? 'border-b border-workspace-border/25' : ''}>
                      {cells.map((cell, j) => (
                        <td key={j} className={`px-4 py-2.5 ${j === 0 ? 'font-medium text-workspace-text' : 'text-workspace-text-secondary tabular-nums'}`}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  /* ── Immersive full view ── */
  return (
    <div className="space-y-5 px-4 py-4">
      <div className="workspace-card-surface rounded-[28px] border border-workspace-border/45 px-6 py-5">
        <div className="flex items-center justify-between mb-6 gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-2xl border border-workspace-border/55 bg-white/85 px-3.5 py-2.5 transition-all duration-200 workspace-spring focus-within:border-workspace-accent/30 focus-within:shadow-[0_14px_30px_rgba(99,102,241,0.12)]">
            <span className="text-workspace-text-secondary/40 text-xs">⌕</span>
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              aria-label="Filter dataset rows"
              placeholder="Filter rows..."
              className="bg-transparent text-sm text-workspace-text placeholder:text-workspace-text-secondary/40 outline-none w-48"
            />
          </div>
          <span className="workspace-pill rounded-full px-3 py-1.5 text-xs text-workspace-text-secondary tabular-nums">
            {filteredAndSorted.length} of {editableRows.length} rows · {visibleCols.length} of {allColumns.length} cols
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Edit toolbar */}
          <button
            onClick={handleAddRow}
            className="workspace-focus-ring workspace-pill flex items-center gap-1.5 rounded-full px-3 py-2 text-xs text-workspace-text-secondary transition-colors hover:text-emerald-600 hover:bg-emerald-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add row
          </button>
          {selectedRows.size > 0 && (
            <button
              onClick={handleDeleteRows}
              className="workspace-focus-ring flex items-center gap-1.5 rounded-full px-3 py-2 text-xs text-red-500 bg-red-50 transition-colors hover:bg-red-100"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete {selectedRows.size} row{selectedRows.size > 1 ? 's' : ''}
            </button>
          )}
          {hasChanges && (
            <>
              <button
                onClick={handleDiscard}
                className="workspace-focus-ring workspace-pill flex items-center gap-1.5 rounded-full px-3 py-2 text-xs text-workspace-text-secondary transition-colors hover:text-workspace-text"
              >
                <Undo2 className="h-3.5 w-3.5" /> Discard
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="workspace-focus-ring flex items-center gap-1.5 rounded-full bg-workspace-accent px-4 py-2 text-xs text-white font-medium transition-all duration-200 workspace-spring hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(99,102,241,0.25)] disabled:translate-y-0 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" /> {isSaving ? 'Saving...' : 'Save changes'}
              </button>
            </>
          )}

          <div className="h-4 w-px bg-workspace-border/40 mx-1" />

          {needsExpand && (
            <button
              onClick={() => setShowAllCols(!showAllCols)}
              className="workspace-focus-ring workspace-pill flex items-center gap-1.5 rounded-full px-3 py-2 text-xs text-workspace-text-secondary transition-colors hover:text-workspace-text"
            >
              <Columns className="h-3.5 w-3.5" />
              {showAllCols ? 'Smart columns' : `All ${allColumns.length} columns`}
            </button>
          )}
          <button
            onClick={handleGenerateInsight}
            disabled={isStreaming}
            className="workspace-focus-ring flex items-center gap-1.5 rounded-full bg-workspace-accent/8 px-3.5 py-2 text-xs text-workspace-accent transition-all duration-200 workspace-spring hover:-translate-y-0.5 hover:bg-workspace-accent/15 hover:shadow-[0_14px_28px_rgba(99,102,241,0.12)] disabled:translate-y-0 disabled:opacity-50"
          >
            <span>✦</span> {isStreaming ? 'Analyzing...' : 'Generate insight'}
          </button>
        </div>
        </div>

      {persistedView.displayMode === 'chart' && (
        <div className="mb-5">
          <TableVisualization columns={allColumns} rows={filteredAndSorted} view={persistedView} title={object.title} />
        </div>
      )}

      {showInsightCard && (
        <div role="status" aria-live="polite" className="animate-[materialize_0.3s_cubic-bezier(0.16,1,0.3,1)_forwards] rounded-2xl bg-workspace-accent-subtle/15 border border-workspace-accent/10 px-5 py-4 shadow-[0_16px_36px_rgba(99,102,241,0.08)]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-workspace-accent text-sm">✦</span>
            <span className="text-[10px] font-medium uppercase tracking-widest text-workspace-accent">
              {isStreaming && !aiInsight ? 'Reading dataset' : 'AI Insight'}
            </span>
          </div>
          {aiInsight ? (
            <MarkdownRenderer content={aiInsight} isStreaming={isStreaming} />
          ) : (
            <div className="space-y-2" aria-hidden="true">
              <div className="workspace-skeleton h-3 rounded-full" />
              <div className="workspace-skeleton h-3 rounded-full" />
              <div className="workspace-skeleton h-3 w-5/6 rounded-full" />
            </div>
          )}
        </div>
      )}
      </div>

      {hasChanges && (
        <div className="flex items-center gap-2 px-2">
          <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-xs text-amber-600 font-medium">
            Unsaved changes — {editableRows.length} rows
          </span>
        </div>
      )}

      <VirtualizedTable
        columns={visibleCols}
        rows={filteredAndSorted}
        totalRows={editableRows.length}
        filterText={filterText}
        sortCol={sortCol}
        sortDir={sortDir}
        onSort={handleSort}
        getVisibleRow={getVisibleRow}
        isEditable
        editingCell={editingCell}
        selectedRows={selectedRows}
        onStartEdit={setEditingCell}
        onCellEdit={handleCellEdit}
        onToggleRow={handleToggleRow}
      />
    </div>
  );
}

const ROW_HEIGHT = 44;

interface VirtualizedTableProps {
  columns: string[];
  rows: string[][];
  totalRows: number;
  filterText: string;
  sortCol: number | null;
  sortDir: SortDir;
  onSort: (idx: number) => void;
  getVisibleRow: (row: string[]) => string[];
  isEditable?: boolean;
  editingCell?: EditingCell;
  selectedRows?: Set<number>;
  onStartEdit?: (cell: EditingCell) => void;
  onCellEdit?: (rowIdx: number, colIdx: number, value: string) => void;
  onToggleRow?: (rowIdx: number) => void;
}

function VirtualizedTable({
  columns,
  rows,
  totalRows,
  filterText,
  sortCol,
  sortDir,
  onSort,
  getVisibleRow,
  isEditable = false,
  editingCell,
  selectedRows,
  onStartEdit,
  onCellEdit,
  onToggleRow,
}: VirtualizedTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  if (rows.length === 0) {
    return (
      <div className="workspace-card-surface flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-[28px] border border-workspace-border/45 bg-white px-6 py-8 text-center">
        <span className="workspace-pill rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/75">
          Table filter
        </span>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-workspace-accent/8 text-lg text-workspace-accent shadow-[0_14px_28px_rgba(99,102,241,0.12)]">
          ⌕
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-workspace-text">No rows match the current view</p>
          <p className="max-w-[34ch] text-xs leading-5 text-workspace-text-secondary/75">
            {filterText
              ? `Nothing in ${totalRows} rows matches "${filterText}". Try a broader filter or switch back to smart columns.`
              : 'There are no rows available in this dataset view yet.'}
          </p>
        </div>
      </div>
    );
  }

  const colCount = columns.length;
  const minColWidth = colCount > 10 ? '160px' : '120px';
  // Add checkbox column if editable
  const gridCols = isEditable
    ? `36px minmax(200px, 2fr) ${Array(colCount - 1).fill(`minmax(${minColWidth}, 1fr)`).join(' ')}`
    : `minmax(200px, 2fr) ${Array(colCount - 1).fill(`minmax(${minColWidth}, 1fr)`).join(' ')}`;

  return (
    <div className="workspace-card-surface rounded-[28px] border border-workspace-border/45 bg-white overflow-hidden">
      <div
        ref={parentRef}
        className="overflow-auto"
        style={{ maxHeight: '70vh' }}
      >
        {/* Sticky header */}
        <div
          className="grid border-b border-workspace-border bg-white text-[11px] font-medium uppercase tracking-[0.18em] text-workspace-text-secondary sticky top-0 z-10"
          style={{ gridTemplateColumns: gridCols }}
        >
          {isEditable && (
            <div className="px-2 py-2.5 flex items-center justify-center">
              {/* Header checkbox placeholder */}
            </div>
          )}
          {columns.map((col, idx) => (
            <div key={`${idx}-${col}`} className="px-4 py-2.5">
              <button
                onClick={() => onSort(idx)}
                aria-sort={sortCol === idx ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className="workspace-focus-ring inline-flex items-center gap-1 rounded-xl px-2 py-1 -mx-2 cursor-pointer select-none transition-colors hover:text-workspace-text text-left leading-tight"
              >
                {col}
                {sortCol === idx && (
                  <span className="text-workspace-accent">
                    {sortDir === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>

        {/* Virtualized body */}
        <div>
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              const cells = getVisibleRow(row);
              const isSelected = selectedRows?.has(virtualRow.index) ?? false;
              return (
                <div
                  key={virtualRow.index}
                  className={`grid border-b border-workspace-border/20 text-[13px] transition-colors ${isSelected ? 'bg-workspace-accent/[0.08]' : 'hover:bg-workspace-accent/[0.04]'}`}
                  style={{
                    gridTemplateColumns: gridCols,
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    backgroundColor: isSelected
                      ? undefined // Let className handle it
                      : virtualRow.index % 2 === 0 ? 'white' : 'rgba(var(--workspace-surface-rgb, 245 245 250) / 0.16)',
                  }}
                >
                  {isEditable && (
                    <div className="px-2 py-2.5 flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleRow?.(virtualRow.index)}
                        className="h-3.5 w-3.5 rounded border-workspace-border/60 text-workspace-accent focus:ring-workspace-accent/30 cursor-pointer"
                      />
                    </div>
                  )}
                  {cells.map((cell, j) => {
                    const isEditing = editingCell?.rowIdx === virtualRow.index && editingCell?.colIdx === j;
                    return (
                      <div
                        key={j}
                        className={`px-4 py-2.5 whitespace-nowrap overflow-hidden text-ellipsis flex items-center ${j === 0 ? 'font-medium text-workspace-text' : 'text-workspace-text-secondary tabular-nums'} ${isEditable ? 'cursor-text' : ''}`}
                        onDoubleClick={() => isEditable && onStartEdit?.({ rowIdx: virtualRow.index, colIdx: j })}
                      >
                        {isEditing ? (
                          <EditableInput
                            initialValue={cell}
                            onCommit={(value) => onCellEdit?.(virtualRow.index, j, value)}
                            onCancel={() => onStartEdit?.(null)}
                          />
                        ) : (
                          <HoverCell value={cell} columnName={columns[j]} entityName={cells[0]} />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function EditableInput({ initialValue, onCommit, onCancel }: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(value);
        if (e.key === 'Escape') onCancel();
        e.stopPropagation();
      }}
      onBlur={() => onCommit(value)}
      className="w-full bg-white border border-workspace-accent/40 rounded px-1.5 py-0.5 text-[13px] text-workspace-text outline-none ring-2 ring-workspace-accent/20"
    />
  );
}

function HoverCell({ value, columnName, entityName }: { value: string; columnName: string; entityName: string }) {
  const cellRef = useRef<HTMLSpanElement>(null);
  const [showMemo, setShowMemo] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shouldShowMemo = value && value.length > 20;

  const handleMouseEnter = useCallback(() => {
    if (!shouldShowMemo) return;
    hoverTimer.current = setTimeout(() => setShowMemo(true), 100);
  }, [shouldShowMemo]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setShowMemo(false);
  }, []);

  return (
    <span
      ref={cellRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="overflow-hidden text-ellipsis"
    >
      <FormattedCell value={value} />
      {showMemo && createPortal(
        <CellDetailBar value={value} columnName={columnName} entityName={entityName} />,
        document.body
      )}
    </span>
  );
}

function CellDetailBar({ value, columnName, entityName }: { value: string; columnName: string; entityName: string }) {
  return (
    <div className="fixed inset-x-0 top-0 z-[200] pointer-events-none animate-[detail-bar-enter_0.28s_cubic-bezier(0.16,1,0.3,1)_forwards]">
      {/* Full-width backdrop */}
      <div className="pointer-events-auto mx-auto max-w-[1400px] px-6 pt-3 pb-0">
        <div className="relative overflow-hidden rounded-2xl border border-white/20 bg-gradient-to-br from-slate-900/[0.97] via-slate-800/[0.97] to-indigo-950/[0.97] backdrop-blur-2xl shadow-[0_32px_80px_rgba(0,0,0,0.35),0_0_0_1px_rgba(255,255,255,0.06),inset_0_1px_0_rgba(255,255,255,0.08)]">

          {/* Ambient glow */}
          <div className="absolute -top-20 -right-20 h-40 w-40 rounded-full bg-indigo-500/10 blur-3xl" />
          <div className="absolute -bottom-10 -left-10 h-32 w-32 rounded-full bg-violet-500/8 blur-3xl" />

          {/* Top edge accent line */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-400/40 to-transparent" />

          <div className="relative flex items-start gap-6 px-7 py-5">

            {/* Left: metadata column */}
            <div className="flex-shrink-0 flex flex-col gap-2.5 min-w-[140px]">
              {/* Entity badge */}
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-indigo-400/80 shadow-[0_0_8px_rgba(129,140,248,0.5)]" />
                <span className="text-sm font-bold text-white tracking-wide truncate max-w-[240px]">
                  {entityName}
                </span>
              </div>

              {/* Column label */}
              <div className="flex items-center gap-1.5 pl-4">
                <svg className="h-3.5 w-3.5 text-indigo-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-200">
                  {columnName}
                </span>
              </div>
            </div>

            {/* Vertical divider */}
            <div className="flex-shrink-0 w-px self-stretch bg-gradient-to-b from-transparent via-white/10 to-transparent" />

            {/* Right: cell content */}
            <div className="flex-1 min-w-0 py-0.5">
              <p className="text-lg leading-[1.7] text-white/95 whitespace-pre-wrap break-words font-bold tracking-[0.01em]">
                {value}
              </p>
            </div>
          </div>

          {/* Bottom edge accent */}
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />
        </div>
      </div>
    </div>
  );
}

function FormattedCell({ value }: { value: string }) {
  if (!value || typeof value !== 'string') return <span>{value}</span>;
  const badges: Record<string, string> = {
    'Watch': 'bg-amber-100 text-amber-700',
    'High': 'bg-red-100 text-red-700',
    'Critical': 'bg-red-100 text-red-700',
    'Low': 'bg-emerald-100 text-emerald-700',
    'Medium': 'bg-amber-100 text-amber-700',
    'Active': 'bg-emerald-100 text-emerald-700',
  };
  if (badges[value]) {
    return <span className={`rounded-full px-2 py-0.5 text-xs ${badges[value]}`}>{value}</span>;
  }
  if (value.length > 60) {
    return <span>{value.slice(0, 57)}…</span>;
  }
  return <span>{value}</span>;
}
