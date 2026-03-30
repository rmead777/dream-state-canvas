import { useState, useMemo, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Columns } from 'lucide-react';
import { WorkspaceObject } from '@/lib/workspace-types';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAI } from '@/hooks/useAI';
import MarkdownRenderer from '@/components/objects/MarkdownRenderer';
import { getDisplayColumns, filterRowToColumns } from '@/lib/smart-columns';
import { getActiveDataset } from '@/lib/active-dataset';
import { getObjectViewState } from '@/lib/workspace-intelligence';
import { TableVisualization } from './TableVisualization';

interface DatasetViewProps {
  object: WorkspaceObject;
  isImmersive?: boolean;
}

type SortDir = 'asc' | 'desc' | null;

export function DatasetView({ object, isImmersive = false }: DatasetViewProps) {
  const { dispatch } = useWorkspace();
  const { streamChat, isStreaming } = useAI();
  const d = object.context;
  const persistedView = getObjectViewState(d);

  // Use live active dataset for full column set — object context may have been
  // captured from seed data before the real document loaded.
  const liveDs = getActiveDataset();
  const allColumns = useMemo<string[]>(
    () => ((liveDs.columns.length > (d.columns || []).length) ? liveDs.columns : (d.columns || [])),
    [d.columns, liveDs.columns]
  );
  const rawRows = useMemo<string[][]>(
    () => ((liveDs.columns.length > (d.columns || []).length) ? liveDs.rows : (d.rows || [])),
    [d.columns, d.rows, liveDs.columns.length, liveDs.rows]
  );
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

  const filteredAndSorted = useMemo(() => {
    let rows = rawRows;
    if (filterText) {
      const lower = filterText.toLowerCase();
      rows = rows.filter((r) => r.some((c) => c.toLowerCase().includes(lower)));
    }
    if (sortCol !== null && sortDir) {
      // Sort is relative to visible columns
      const realIdx = allColumns.indexOf(visibleCols[sortCol]);
      if (realIdx >= 0) {
        rows = [...rows].sort((a, b) => {
          const av = a[realIdx] ?? '';
          const bv = b[realIdx] ?? '';
          const cmp = av.localeCompare(bv, undefined, { numeric: true });
          return sortDir === 'asc' ? cmp : -cmp;
        });
      }
    }
    return rows;
  }, [rawRows, sortCol, sortDir, filterText, allColumns, visibleCols]);

  const getVisibleRow = useCallback(
    (row: string[]) => (showAllCols ? row : filterRowToColumns(row, allColumns, smartCols)),
    [showAllCols, allColumns, smartCols]
  );

  const handleGenerateInsight = useCallback(async () => {
    if (isStreaming) return;
    setAiInsight('');
    const tableStr = [allColumns.join(' | '), ...rawRows.slice(0, 30).map((r) => r.join(' | '))].join('\n');
    await streamChat(
      [{ role: 'user', content: `Analyze this dataset and provide 2-3 key insights:\n\n${tableStr}` }],
      { mode: 'dataset', onDelta: (text) => setAiInsight((prev) => (prev || '') + text) }
    );
  }, [isStreaming, streamChat, allColumns, rawRows]);

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
                  {previewCols.map((col) => (
                    <th key={col} className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.18em] text-workspace-text-secondary whitespace-nowrap">
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
            {filteredAndSorted.length} of {rawRows.length} rows · {visibleCols.length} of {allColumns.length} cols
          </span>
        </div>

        <div className="flex items-center gap-2">
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
          <button className="workspace-focus-ring workspace-pill flex items-center gap-1.5 rounded-full px-3 py-2 text-xs text-workspace-text-secondary transition-colors hover:text-workspace-text">
            📊 Generate chart
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

      <VirtualizedTable
        columns={visibleCols}
        rows={filteredAndSorted}
        totalRows={rawRows.length}
        filterText={filterText}
        sortCol={sortCol}
        sortDir={sortDir}
        onSort={handleSort}
        getVisibleRow={getVisibleRow}
      />
    </div>
  );
}

const ROW_HEIGHT = 44; // px per row for virtualizer estimation

function VirtualizedTable({
  columns,
  rows,
  totalRows,
  filterText,
  sortCol,
  sortDir,
  onSort,
  getVisibleRow,
}: {
  columns: string[];
  rows: string[][];
  totalRows: number;
  filterText: string;
  sortCol: number | null;
  sortDir: SortDir;
  onSort: (idx: number) => void;
  getVisibleRow: (row: string[]) => string[];
}) {
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
              ? `Nothing in ${totalRows} rows matches “${filterText}”. Try a broader filter or switch back to smart columns.`
              : 'There are no rows available in this dataset view yet.'}
          </p>
        </div>
      </div>
    );
  }

  const colCount = columns.length;
  // Wider minimums for many-column datasets to prevent header overlap
  const minColWidth = colCount > 10 ? '160px' : '120px';
  const gridCols = `minmax(200px, 2fr) ${Array(colCount - 1).fill(`minmax(${minColWidth}, 1fr)`).join(' ')}`;

  return (
    <div className="workspace-card-surface rounded-[28px] border border-workspace-border/45 bg-white overflow-hidden">
      {/* Single scroll container for both header + body — keeps columns aligned */}
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
          {columns.map((col, idx) => (
            <div
              key={col}
              className="px-4 py-2.5"
            >
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
              return (
                <div
                  key={virtualRow.index}
                  className="grid border-b border-workspace-border/20 text-[13px] transition-colors hover:bg-workspace-accent/[0.04]"
                  style={{
                    gridTemplateColumns: gridCols,
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    backgroundColor: virtualRow.index % 2 === 0 ? 'white' : 'rgba(var(--workspace-surface-rgb, 245 245 250) / 0.16)',
                  }}
                >
                  {cells.map((cell, j) => (
                    <div
                      key={j}
                      className={`px-4 py-2.5 whitespace-nowrap overflow-hidden text-ellipsis flex items-center ${j === 0 ? 'font-medium text-workspace-text' : 'text-workspace-text-secondary tabular-nums'}`}
                    >
                      <FormattedCell value={cell} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
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
  // Truncate very long cells in table view
  if (value.length > 60) {
    return <span title={value}>{value.slice(0, 57)}…</span>;
  }
  return <span>{value}</span>;
}
