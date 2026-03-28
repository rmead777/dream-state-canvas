import { useEffect, useState } from 'react';
import { Columns } from 'lucide-react';
import { WorkspaceObject } from '@/lib/workspace-types';
import { getDisplayColumns, filterRowToColumns } from '@/lib/smart-columns';

type BreakdownItem = { name: string; value: number };
type Thresholds = { warning?: number; critical?: number } | null;

function toNumeric(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatMetricValue(value: number, unit: string, compact = false): string {
  if (unit === '$') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 2 : 0,
    }).format(value);
  }

  return new Intl.NumberFormat('en-US', {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value) + unit;
}

function formatMetricDelta(value: number, unit: string): string {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${formatMetricValue(value, unit)}`;
}

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
        className="h-full rounded-full transition-all duration-700"
        style={{
          width: `${Math.min(width, 100)}%`,
          backgroundColor: isWarn ? 'hsl(var(--workspace-accent))' : 'hsl(160 50% 45%)',
          transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
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
function extractMetricCards(sources: WorkspaceObject[]): { title: string; value: number; unit: string; change: number; trend: string; sparkline: number[]; breakdown: BreakdownItem[]; threshold: Thresholds }[] {
  return sources
    .filter(o => o.context?.currentValue !== undefined)
    .map(o => ({
      title: o.title,
      value: toNumeric(o.context.currentValue),
      unit: o.context.unit || '',
      change: toNumeric(o.context.change ?? 0),
      trend: o.context.trend || '',
      sparkline: Array.isArray(o.context.sparkline) ? o.context.sparkline.map((point: unknown) => toNumeric(point)) : [],
      breakdown: Array.isArray(o.context.breakdown)
        ? o.context.breakdown.map((item: any) => ({ name: item.name, value: toNumeric(item.value) }))
        : [],
      threshold: o.context.threshold
        ? {
            warning: o.context.threshold.warning !== undefined ? toNumeric(o.context.threshold.warning) : undefined,
            critical: o.context.threshold.critical !== undefined ? toNumeric(o.context.threshold.critical) : undefined,
          }
        : null,
    }));
}

export function FusionDataVisuals({ sources }: { sources: WorkspaceObject[] }) {
  const table = extractTableData(sources);
  const metrics = extractMetricCards(sources);
  const [showAllCols, setShowAllCols] = useState(false);

  const smartCols = table ? getDisplayColumns(table.columns, table.rows) : [];
  const needsExpand = table ? table.columns.length > smartCols.length : false;
  const visibleCols = showAllCols ? (table?.columns || []) : smartCols;

  if (!table && metrics.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Metric headline cards — same visual language as MetricDetail */}
      {metrics.map((m, i) => (
        <div key={i} className="workspace-card-surface rounded-[24px] border border-workspace-border/40 px-4 py-4 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-workspace-accent/70">
                Metric spotlight
              </div>
              <div className="mt-1 text-sm font-medium leading-6 text-workspace-text">{m.title}</div>

              <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-1">
                <span className="text-3xl font-light tracking-[-0.03em] text-workspace-text tabular-nums">
                  {formatMetricValue(m.value, m.unit, true)}
                </span>
                <span className="pb-1 text-[11px] text-workspace-text-secondary/72 tabular-nums">
                  {formatMetricValue(m.value, m.unit)} total exposure
                </span>
              </div>

              <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-workspace-surface/45 px-2.5 py-1 text-[11px] text-workspace-text-secondary tabular-nums">
                <span>{formatMetricDelta(m.change, m.unit)} over 30d</span>
                <span className={`${m.trend === 'increasing' ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {m.trend === 'increasing' ? '↑ escalating' : '↓ easing'}
                </span>
              </div>
            </div>

            {m.sparkline.length >= 2 && (
              <div className="workspace-pill flex min-w-[132px] flex-col items-end gap-2 rounded-2xl px-3 py-2">
                <span className="text-[10px] uppercase tracking-[0.18em] text-workspace-text-secondary/55">30d drift</span>
                <AnimatedSparkline data={m.sparkline} />
              </div>
            )}
          </div>

          {/* Breakdown with progress bars */}
          {m.breakdown.length > 0 && (
            <div className="mt-4 grid gap-2.5 rounded-2xl border border-workspace-border/35 bg-white/70 px-3 py-3">
              {m.breakdown.map((b) => (
                <div key={b.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-xs">
                  <div className="min-w-0">
                    <span className="block truncate text-workspace-text">{b.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MiniBar
                      value={b.value}
                      max={m.threshold?.critical || Math.max(...m.breakdown.map((x) => x.value), 5)}
                      warn={m.threshold?.warning}
                    />
                    <span className="font-medium text-workspace-text min-w-[92px] text-right tabular-nums">{formatMetricValue(b.value, m.unit)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Threshold pills */}
          {m.threshold && (
            <div className="mt-3 flex flex-wrap gap-2 pt-0.5">
              {m.threshold.warning !== undefined && (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] text-amber-700 tabular-nums">
                  Warning: {formatMetricValue(m.threshold.warning, m.unit)}
                </span>
              )}
              {m.threshold.critical !== undefined && (
                <span className="rounded-full bg-red-50 px-2.5 py-1 text-[10px] text-red-700 tabular-nums">
                  Critical: {formatMetricValue(m.threshold.critical, m.unit)}
                </span>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Formatted data table with smart column selection */}
      {table && (
        <div className="space-y-1.5 rounded-2xl border border-workspace-border/35 bg-white/60 p-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-workspace-accent/70">
              Supporting rows
            </span>
            <span className="text-[10px] text-workspace-text-secondary/55 tabular-nums">
              {table.rows.length} rows
            </span>
          </div>
          {needsExpand && (
            <div className="flex justify-end">
              <button
                onClick={() => setShowAllCols(!showAllCols)}
                className="workspace-focus-ring flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] text-workspace-text-secondary transition-colors hover:bg-workspace-surface hover:text-workspace-text"
              >
                <Columns className="h-3 w-3" />
                {showAllCols ? 'Smart columns' : `All ${table.columns.length} columns`}
              </button>
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-workspace-border/30">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-workspace-border/30 bg-workspace-surface/30">
                  {visibleCols.map(col => (
                    <th key={col} className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-workspace-text-secondary whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => {
                  const cells = showAllCols ? row : filterRowToColumns(row, table.columns, smartCols);
                  return (
                    <tr key={i} className={i < table.rows.length - 1 ? 'border-b border-workspace-border/20' : ''}>
                      {cells.map((cell, j) => (
                        <td key={j} className={`px-3 py-1.5 whitespace-nowrap ${j === 0 ? 'font-medium text-workspace-text' : 'text-workspace-text-secondary tabular-nums'}`}>
                          <FormattedCell value={cell} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
