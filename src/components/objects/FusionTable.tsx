import { useEffect, useRef, useState } from 'react';
import { Columns } from 'lucide-react';
import { WorkspaceObject } from '@/lib/workspace-types';
import { getDisplayColumns, filterRowToColumns } from '@/lib/smart-columns';

/** Animated sparkline matching MetricDetail style — draw-in + pulse dot */
function AnimatedSparkline({ data, color = 'hsl(var(--workspace-accent))' }: { data: number[]; color?: string }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let start: number | null = null;
    const duration = 700;
    const animate = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      setProgress(p);
      if (p < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, []);

  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 80, h = 24;
  const visibleCount = Math.ceil(data.length * progress);
  const points = data
    .slice(0, visibleCount)
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(' ');

  const lastIdx = visibleCount - 1;
  const lastX = lastIdx >= 0 ? (lastIdx / (data.length - 1)) * w : 0;
  const lastY = lastIdx >= 0 ? h - ((data[lastIdx] - min) / range) * h : 0;

  return (
    <svg width={w} height={h} className="inline-block align-middle">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {progress >= 1 && (
        <circle cx={lastX} cy={lastY} r="2" fill={color} className="animate-pulse" />
      )}
    </svg>
  );
}

/** Animated progress bar like MetricDetail breakdown rows */
function MiniBar({ value, max, warn }: { value: number; max: number; warn?: number }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    requestAnimationFrame(() => setWidth((value / max) * 100));
  }, [value, max]);

  const isWarn = warn !== undefined && value >= warn;

  return (
    <div className="h-1.5 w-16 rounded-full bg-workspace-border/40 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{
          width: `${Math.min(width, 100)}%`,
          backgroundColor: isWarn ? 'hsl(var(--workspace-accent))' : 'hsl(160 50% 45%)',
        }}
      />
    </div>
  );
}

/** Conditional formatting badges — same style as DataInspector */
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

  if (value.startsWith('+')) return <span className="text-emerald-600 font-medium">{value}</span>;
  if (value.startsWith('-') && /^-[\d.]/.test(value)) return <span className="text-red-500 font-medium">{value}</span>;

  return <span>{value}</span>;
}

/** Parse a numeric-ish string like "$2.4B", "3.6x", "+12.4%" */
function parseNum(val: string): number | null {
  if (!val || typeof val !== 'string') return null;
  const cleaned = val.replace(/[$%xBMK,+]/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/** Extract table-like data from source objects */
function extractTableData(sources: WorkspaceObject[]): { columns: string[]; rows: string[][] } | null {
  for (const obj of sources) {
    const ctx = obj.context;
    if (ctx?.columns && ctx?.rows && ctx.rows.length > 0) {
      return { columns: ctx.columns, rows: ctx.rows };
    }
  }
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
  return null;
}

/** Extract sparkline + metric headline from sources */
function extractMetricCards(sources: WorkspaceObject[]): { title: string; value: string; unit: string; change: string; trend: string; sparkline: number[]; breakdown: any[]; threshold: any }[] {
  return sources
    .filter(o => o.context?.currentValue !== undefined)
    .map(o => ({
      title: o.title,
      value: String(o.context.currentValue),
      unit: o.context.unit || '',
      change: `${o.context.change > 0 ? '+' : ''}${o.context.change}${o.context.unit || ''}`,
      trend: o.context.trend || '',
      sparkline: o.context.sparkline || [],
      breakdown: o.context.breakdown || [],
      threshold: o.context.threshold || null,
    }));
}

export function FusionDataVisuals({ sources }: { sources: WorkspaceObject[] }) {
  const table = extractTableData(sources);
  const metrics = extractMetricCards(sources);

  if (!table && metrics.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Metric headline cards — same visual language as MetricDetail */}
      {metrics.map((m, i) => (
        <div key={i} className="rounded-xl border border-workspace-border/30 bg-workspace-surface/20 p-3 space-y-2">
          <div className="text-[10px] font-medium uppercase tracking-wider text-workspace-text-secondary">
            {m.title}
          </div>
          <div className="flex items-end justify-between">
            <div>
              <span className="text-2xl font-light tracking-tight text-workspace-text">
                {m.value}{m.unit}
              </span>
              <div className="mt-0.5 text-[11px] text-workspace-text-secondary">
                {m.change} over 30d
                <span className={`ml-1.5 ${m.trend === 'increasing' ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {m.trend === 'increasing' ? '↑' : '↓'}
                </span>
              </div>
            </div>
            {m.sparkline.length >= 2 && <AnimatedSparkline data={m.sparkline} />}
          </div>

          {/* Breakdown with progress bars */}
          {m.breakdown.length > 0 && (
            <div className="space-y-1.5 pt-1">
              {m.breakdown.map((b: any) => (
                <div key={b.name} className="flex items-center justify-between text-xs">
                  <span className="text-workspace-text">{b.name}</span>
                  <div className="flex items-center gap-2">
                    <MiniBar
                      value={b.value}
                      max={m.threshold?.critical || Math.max(...m.breakdown.map((x: any) => x.value), 5)}
                      warn={m.threshold?.warning}
                    />
                    <span className="font-medium text-workspace-text w-10 text-right">{b.value}{m.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Threshold pills */}
          {m.threshold && (
            <div className="flex gap-2 pt-0.5">
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
                Warning: {m.threshold.warning}{m.unit}
              </span>
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] text-red-700">
                Critical: {m.threshold.critical}{m.unit}
              </span>
            </div>
          )}
        </div>
      ))}

      {/* Formatted data table with badges */}
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
