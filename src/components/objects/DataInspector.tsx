import { useState } from 'react';
import { ChevronDown, ChevronRight, Columns } from 'lucide-react';
import { WorkspaceObject } from '@/lib/workspace-types';
import { getDisplayColumns, filterRowToColumns } from '@/lib/smart-columns';

function CollapsibleSection({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`grid transition-all duration-200 ${collapsed ? 'grid-rows-[0fr] opacity-0 -translate-y-1' : 'grid-rows-[1fr] opacity-100 translate-y-0'}`}
      aria-hidden={collapsed}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

export function DataInspector({ object }: { object: WorkspaceObject }) {
  const allColumns: string[] = object.context?.columns || [];
  const rows: string[][] = object.context?.rows || [];
  const [collapsed, setCollapsed] = useState(false);
  const [showAllCols, setShowAllCols] = useState(false);

  const smartCols = getDisplayColumns(allColumns, rows);
  const needsExpand = allColumns.length > smartCols.length;
  const visibleCols = showAllCols ? allColumns : smartCols;

  const getVisibleRow = (row: string[]) =>
    showAllCols ? row : filterRowToColumns(row, allColumns, smartCols);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 text-left group"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-workspace-accent flex-shrink-0" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-workspace-accent flex-shrink-0" />
          )}
          <span className="text-[10px] font-medium uppercase tracking-wider text-workspace-text-secondary group-hover:text-workspace-text transition-colors">
            Data Table · <span className="tabular-nums">{rows.length}</span> rows · <span className="tabular-nums">{visibleCols.length}</span> of <span className="tabular-nums">{allColumns.length}</span> columns
          </span>
        </button>

        {!collapsed && needsExpand && (
          <button
            onClick={() => setShowAllCols(!showAllCols)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-workspace-text-secondary transition-colors hover:bg-workspace-surface hover:text-workspace-text"
          >
            <Columns className="h-3 w-3" />
            {showAllCols ? 'Smart columns' : `All ${allColumns.length} columns`}
          </button>
        )}
      </div>

      <CollapsibleSection collapsed={collapsed}>
        <div className="overflow-x-auto rounded-lg border border-workspace-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-workspace-border bg-workspace-surface/50">
                {visibleCols.map((col: string) => (
                  <th
                    key={col}
                    className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-workspace-text-secondary whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row: string[], i: number) => {
                const cells = getVisibleRow(row);
                return (
                  <tr
                    key={i}
                    className={`${i < rows.length - 1 ? 'border-b border-workspace-border/30' : ''} transition-colors hover:bg-workspace-surface/30`}
                  >
                    {cells.map((cell, j) => (
                      <td
                        key={j}
                        className={`px-4 py-2.5 whitespace-nowrap ${j === 0 ? 'font-medium text-workspace-text' : 'text-workspace-text-secondary tabular-nums'}`}
                      >
                        <FormattedCell value={cell} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>
    </div>
  );
}

function FormattedCell({ value }: { value: string }) {
  if (!value || typeof value !== 'string') return <span>{value}</span>;
  const badges: Record<string, string> = {
    'High': 'bg-red-100 text-red-700',
    'Critical': 'bg-red-100 text-red-700',
    'Medium': 'bg-amber-100 text-amber-700',
    'Watch': 'bg-amber-100 text-amber-700',
    'Low': 'bg-emerald-100 text-emerald-700',
    'Active': 'bg-emerald-100 text-emerald-700',
    'Stable': 'bg-emerald-100 text-emerald-700',
  };
  if (badges[value]) {
    return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badges[value]}`}>{value}</span>;
  }
  // Truncate long text cells
  if (value.length > 80) {
    return <span title={value}>{value.slice(0, 77)}…</span>;
  }
  return <span>{value}</span>;
}
