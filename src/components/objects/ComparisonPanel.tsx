import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { WorkspaceObject } from '@/lib/workspace-types';

export function ComparisonPanel({ object }: { object: WorkspaceObject }) {
  const d = object.context;
  const entities = d.entities || [];
  const highlights = d.highlights || [];
  const [tableCollapsed, setTableCollapsed] = useState(false);

  if (entities.length < 2) return null;

  const metricKeys = Object.keys(entities[0]?.metrics || {});

  return (
    <div className="space-y-4">
      {/* Collapsible comparison table */}
      <div className="space-y-2">
        <button
          onClick={() => setTableCollapsed(!tableCollapsed)}
          className="flex items-center gap-2 w-full text-left group"
        >
          {tableCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-workspace-accent flex-shrink-0" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-workspace-accent flex-shrink-0" />
          )}
          <span className="text-[10px] font-medium uppercase tracking-wider text-workspace-text-secondary group-hover:text-workspace-text transition-colors">
            Comparison Table · <span className="tabular-nums">{entities.length}</span> entities
          </span>
        </button>

        {!tableCollapsed && (
          <div className="overflow-hidden rounded-lg border border-workspace-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-workspace-border bg-workspace-surface/50">
                  <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-workspace-text-secondary">
                    Metric
                  </th>
                  {entities.map((e: any) => (
                    <th
                      key={e.name}
                      className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-workspace-text-secondary"
                    >
                      {e.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metricKeys.map((key, i) => (
                  <tr
                    key={key}
                    className={i < metricKeys.length - 1 ? 'border-b border-workspace-border/50' : ''}
                  >
                    <td className="px-4 py-2.5 text-workspace-text-secondary capitalize">{key}</td>
                    {entities.map((e: any) => (
                      <td key={e.name} className="px-4 py-2.5 text-right font-medium text-workspace-text tabular-nums">
                        {e.metrics[key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Highlights */}
      {highlights.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wider text-workspace-text-secondary">
            Key Insights
          </div>
          {highlights.map((h: any, i: number) => (
            <div
              key={i}
              className="rounded-lg bg-workspace-accent-subtle/50 px-3 py-2 text-sm text-workspace-text"
            >
              {h.insight}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
