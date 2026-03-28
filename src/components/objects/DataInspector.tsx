import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { WorkspaceObject } from '@/lib/workspace-types';

export function DataInspector({ object }: { object: WorkspaceObject }) {
  const columns = object.context?.columns || [];
  const rows = object.context?.rows || [];
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="space-y-2">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full text-left group"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 text-workspace-accent flex-shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-workspace-accent flex-shrink-0" />
        )}
        <span className="text-[10px] font-medium uppercase tracking-wider text-workspace-text-secondary group-hover:text-workspace-text transition-colors">
          Data Table · {rows.length} rows
        </span>
      </button>

      {!collapsed && (
        <div className="overflow-hidden rounded-lg border border-workspace-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-workspace-border bg-workspace-surface/50">
                {columns.map((col: string) => (
                  <th
                    key={col}
                    className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-workspace-text-secondary"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row: string[], i: number) => (
                <tr
                  key={i}
                  className={`${i < rows.length - 1 ? 'border-b border-workspace-border/30' : ''} transition-colors hover:bg-workspace-surface/30`}
                >
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={`px-4 py-2.5 ${j === 0 ? 'font-medium text-workspace-text' : 'text-workspace-text-secondary'}`}
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
      )}
    </div>
  );
}
