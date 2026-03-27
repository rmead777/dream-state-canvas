import { WorkspaceObject } from '@/lib/workspace-types';

export function ComparisonPanel({ object }: { object: WorkspaceObject }) {
  const d = object.context;
  const entities = d.entities || [];
  const highlights = d.highlights || [];

  if (entities.length < 2) return null;

  const metricKeys = Object.keys(entities[0]?.metrics || {});

  return (
    <div className="space-y-4">
      {/* Comparison table */}
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
                  <td key={e.name} className="px-4 py-2.5 text-right font-medium text-workspace-text">
                    {e.metrics[key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
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
