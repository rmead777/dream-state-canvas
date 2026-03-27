import { WorkspaceObject } from '@/lib/workspace-types';

/** Tiny inline SVG sparkline */
function Sparkline({ data, color = 'hsl(220, 60%, 55%)' }: { data: number[]; color?: string }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 64, h = 20;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
  return (
    <svg width={w} height={h} className="inline-block align-middle">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Conditional formatting for cell values */
function FormattedCell({ value }: { value: string }) {
  if (!value || typeof value !== 'string') return <span>{value}</span>;

  // Risk / status badges
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

  // Positive/negative number coloring
  if (value.startsWith('+')) {
    return <span className="text-emerald-600 font-medium">{value}</span>;
  }
  if (value.startsWith('-') && /^-[\d.]/.test(value)) {
    return <span className="text-red-500 font-medium">{value}</span>;
  }

  return <span>{value}</span>;
}

/** Extract table-like data from source objects */
function extractTableData(sources: WorkspaceObject[]): { columns: string[]; rows: string[][] } | null {
  for (const obj of sources) {
    const ctx = obj.context;
    if (ctx?.columns && ctx?.rows && ctx.rows.length > 0) {
      return { columns: ctx.columns, rows: ctx.rows };
    }
  }

  // Try building from comparison entities
  for (const obj of sources) {
    if (obj.context?.entities?.length > 0) {
      const entities = obj.context.entities;
      const metricKeys = Object.keys(entities[0].metrics || {});
      if (metricKeys.length === 0) continue;
      const columns = ['Name', ...metricKeys];
      const rows = entities.map((e: any) => [e.name, ...metricKeys.map((k: string) => String(e.metrics[k] ?? ''))]);
      return { columns, rows };
    }
  }

  // Try from metric breakdown
  for (const obj of sources) {
    if (obj.context?.breakdown?.length > 0) {
      const columns = ['Name', obj.title];
      const rows = obj.context.breakdown.map((b: any) => [b.name, String(b.value)]);
      return { columns, rows };
    }
  }

  return null;
}

/** Extract sparkline data from sources */
function extractSparklines(sources: WorkspaceObject[]): { title: string; data: number[] }[] {
  return sources
    .filter(o => o.context?.sparkline?.length >= 2)
    .map(o => ({ title: o.title, data: o.context.sparkline }));
}

export function FusionDataVisuals({ sources }: { sources: WorkspaceObject[] }) {
  const table = extractTableData(sources);
  const sparklines = extractSparklines(sources);

  if (!table && sparklines.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Inline sparklines */}
      {sparklines.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {sparklines.map((s, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-workspace-border/30 bg-workspace-surface/20 px-3 py-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-workspace-text-secondary">{s.title}</span>
              <Sparkline data={s.data} />
              <span className="text-xs font-medium text-workspace-text">{s.data[s.data.length - 1]?.toFixed?.(1) ?? s.data[s.data.length - 1]}</span>
            </div>
          ))}
        </div>
      )}

      {/* Formatted data table */}
      {table && (
        <div className="overflow-hidden rounded-lg border border-workspace-border/30">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-workspace-border/30 bg-workspace-surface/30">
                {table.columns.map(col => (
                  <th key={col} className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-workspace-text-secondary">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i} className={i < table.rows.length - 1 ? 'border-b border-workspace-border/20' : ''}>
                  {row.map((cell, j) => (
                    <td key={j} className={`px-3 py-1.5 ${j === 0 ? 'font-medium text-workspace-text' : 'text-workspace-text-secondary'}`}>
                      <FormattedCell value={cell} />
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
