import { useState, useMemo } from 'react';
import { WorkspaceObject } from '@/lib/workspace-types';
import { useWorkspace } from '@/contexts/WorkspaceContext';

interface DatasetViewProps {
  object: WorkspaceObject;
  isImmersive?: boolean;
}

type SortDir = 'asc' | 'desc' | null;

export function DatasetView({ object, isImmersive = false }: DatasetViewProps) {
  const { dispatch } = useWorkspace();
  const d = object.context;
  const columns: string[] = d.columns || [];
  const rawRows: string[][] = d.rows || [];
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [filterText, setFilterText] = useState('');
  const [aiInsight, setAiInsight] = useState<string | null>(null);

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
      rows = [...rows].sort((a, b) => {
        const av = a[sortCol] ?? '';
        const bv = b[sortCol] ?? '';
        const cmp = av.localeCompare(bv, undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [rawRows, sortCol, sortDir, filterText]);

  const handleGenerateInsight = () => {
    setAiInsight(
      'Fund Beta shows the highest leverage at 3.6x with only +6.2% YTD return — a risk-adjusted underperformer. Fund Delta at 1.9x leverage with +15.1% return represents the strongest risk-adjusted position. Consider rebalancing exposure.'
    );
  };

  const handleEnterImmersive = () => {
    dispatch({ type: 'ENTER_IMMERSIVE', payload: { id: object.id } });
  };

  if (!isImmersive) {
    // Compact card view
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-workspace-text-secondary">
            {rawRows.length} rows · {columns.length} columns
          </span>
          <button
            onClick={handleEnterImmersive}
            className="rounded-md px-2.5 py-1 text-[10px] text-workspace-accent transition-colors hover:bg-workspace-accent-subtle/30"
          >
            Expand dataset →
          </button>
        </div>
        {/* Mini preview table */}
        <div className="overflow-hidden rounded-lg border border-workspace-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-workspace-border bg-workspace-surface/50">
                {columns.slice(0, 4).map((col) => (
                  <th key={col} className="px-3 py-2 text-left font-medium uppercase tracking-wider text-workspace-text-secondary">
                    {col}
                  </th>
                ))}
                {columns.length > 4 && (
                  <th className="px-3 py-2 text-left text-workspace-text-secondary/40">+{columns.length - 4}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rawRows.slice(0, 3).map((row, i) => (
                <tr key={i} className={i < 2 ? 'border-b border-workspace-border/30' : ''}>
                  {row.slice(0, 4).map((cell, j) => (
                    <td key={j} className={`px-3 py-2 ${j === 0 ? 'font-medium text-workspace-text' : 'text-workspace-text-secondary'}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Full immersive dataset view
  return (
    <div className="px-8 py-8">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-workspace-border bg-white px-3 py-2 transition-all focus-within:border-workspace-accent/30">
            <span className="text-workspace-text-secondary/40 text-xs">⌕</span>
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter rows..."
              className="bg-transparent text-sm text-workspace-text placeholder:text-workspace-text-secondary/40 outline-none w-48"
            />
          </div>
          <span className="text-xs text-workspace-text-secondary">
            {filteredAndSorted.length} of {rawRows.length} rows
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerateInsight}
            className="flex items-center gap-1.5 rounded-lg bg-workspace-accent/8 px-3 py-2 text-xs text-workspace-accent transition-colors hover:bg-workspace-accent/15"
          >
            <span>✦</span> Generate insight
          </button>
          <button className="flex items-center gap-1.5 rounded-lg border border-workspace-border px-3 py-2 text-xs text-workspace-text-secondary transition-colors hover:bg-workspace-surface">
            📊 Generate chart
          </button>
        </div>
      </div>

      {/* AI Insight */}
      {aiInsight && (
        <div className="mb-6 animate-[materialize_0.3s_cubic-bezier(0.16,1,0.3,1)_forwards] rounded-xl bg-workspace-accent-subtle/15 border border-workspace-accent/10 px-5 py-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-workspace-accent text-sm">✦</span>
            <span className="text-[10px] font-medium uppercase tracking-widest text-workspace-accent">AI Insight</span>
          </div>
          <p className="text-sm leading-relaxed text-workspace-text">{aiInsight}</p>
        </div>
      )}

      {/* Full table */}
      <div className="overflow-hidden rounded-xl border border-workspace-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-workspace-border bg-workspace-surface/30">
              {columns.map((col, idx) => (
                <th
                  key={col}
                  onClick={() => handleSort(idx)}
                  className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-workspace-text-secondary cursor-pointer transition-colors hover:text-workspace-text select-none"
                >
                  <span className="inline-flex items-center gap-1">
                    {col}
                    {sortCol === idx && (
                      <span className="text-workspace-accent">
                        {sortDir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredAndSorted.map((row, i) => (
              <tr
                key={i}
                className={`transition-colors hover:bg-workspace-surface/30 ${
                  i < filteredAndSorted.length - 1 ? 'border-b border-workspace-border/20' : ''
                }`}
              >
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className={`px-5 py-3 ${j === 0 ? 'font-medium text-workspace-text' : 'text-workspace-text-secondary'}`}
                  >
                    {cell === 'Watch' ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{cell}</span>
                    ) : cell === 'High' ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">{cell}</span>
                    ) : cell === 'Low' ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">{cell}</span>
                    ) : cell === 'Medium' ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{cell}</span>
                    ) : cell === 'Active' ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">{cell}</span>
                    ) : (
                      cell
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
