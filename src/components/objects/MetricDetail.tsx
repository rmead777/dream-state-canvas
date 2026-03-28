import { useEffect, useState } from 'react';
import { WorkspaceObject } from '@/lib/workspace-types';

// Format a number as currency: $1,234,567
function formatCurrency(value: number): string {
  return '$' + value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// Format a number with unit prefix
function formatValue(value: number, unit: string): string {
  if (unit === '$') return formatCurrency(value);
  return value.toLocaleString('en-US') + unit;
}

// Tier distribution mini-chart — horizontal stacked bar showing proportions
function TierDistribution({ breakdown }: { breakdown: { name: string; value: number }[] }) {
  const total = breakdown.reduce((s, b) => s + b.value, 0) || 1;
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let start: number | null = null;
    const duration = 800;
    const animate = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      setProgress(1 - Math.pow(1 - p, 3));
      if (p < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, []);

  const colors = [
    'hsl(0 72% 55%)',      // Tier 1 — red/urgent
    'hsl(35 92% 55%)',     // Tier 2 — amber
    'hsl(220 15% 55%)',    // Tier 3 — neutral
    'hsl(220 15% 75%)',    // Tier 4 — light
  ];

  return (
    <div className="flex flex-col items-end gap-1.5">
      {/* Stacked horizontal bar */}
      <div className="flex h-3 w-28 overflow-hidden rounded-full bg-workspace-border/30">
        {breakdown.map((item, i) => {
          const pct = (item.value / total) * 100 * progress;
          return (
            <div
              key={item.name}
              className="h-full transition-all duration-700 first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${pct}%`,
                backgroundColor: colors[i] || colors[3],
                minWidth: pct > 0 ? '2px' : '0',
                transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            />
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex gap-2">
        {breakdown.slice(0, 2).map((item, i) => (
          <div key={item.name} className="flex items-center gap-1">
            <div
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: colors[i] }}
            />
            <span className="text-[9px] text-workspace-text-secondary/60">
              {item.name.replace(/Tier \d — /, '')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Count-up animation for metric values
function AnimatedValue({ value, unit }: { value: number; unit: string }) {
  const [display, setDisplay] = useState(unit === '$' ? '$0' : '0');

  useEffect(() => {
    const duration = 600;
    let start: number | null = null;

    const animate = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const current = value * eased;
      setDisplay(formatValue(Math.round(current), unit));
      if (p < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [value, unit]);

  return <>{display}</>;
}

export function MetricDetail({ object }: { object: WorkspaceObject }) {
  const d = object.context;

  // Compute max breakdown value for consistent bar scaling
  const breakdownMax = d.breakdown
    ? Math.max(...d.breakdown.map((b: any) => b.value), 1)
    : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-3xl font-light tracking-tight text-workspace-text tabular-nums">
            <AnimatedValue value={d.currentValue} unit={d.unit} />
          </div>
          <div className="mt-1 text-xs text-workspace-text-secondary">
            <span className="tabular-nums">
              {d.unit === '$' ? (d.change > 0 ? '+' : '') + formatCurrency(d.change) : (d.change > 0 ? '+' : '') + d.change + d.unit}
            </span>
            {' '}over {d.changePeriod}
            <span className={`ml-2 ${d.trend === 'increasing' ? 'text-amber-600' : 'text-emerald-600'}`}>
              {d.trend === 'increasing' ? '↑ trending up' : '↓ trending down'}
            </span>
          </div>
        </div>
        {d.breakdown && <TierDistribution breakdown={d.breakdown} />}
      </div>

      {d.threshold && (
        <div className="flex gap-3 text-xs">
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700 tabular-nums">
            Warning: {formatValue(d.threshold.warning, d.unit)}
          </span>
          <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700 tabular-nums">
            Critical: {formatValue(d.threshold.critical, d.unit)}
          </span>
        </div>
      )}

      {d.context && (
        <p className="text-sm leading-relaxed text-workspace-text-secondary">{d.context}</p>
      )}

      {d.breakdown && (
        <div className="space-y-2.5 pt-2">
          <div className="text-xs font-medium uppercase tracking-wider text-workspace-text-secondary">
            Breakdown
          </div>
          {d.breakdown.map((item: any, idx: number) => (
            <BreakdownRow key={item.name} item={item} unit={d.unit} maxValue={breakdownMax} tierIndex={idx} />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[10px] text-workspace-text-secondary/40">Live</span>
      </div>
    </div>
  );
}

const TIER_COLORS = [
  'hsl(0 72% 55%)',      // Tier 1 — red/urgent
  'hsl(35 92% 55%)',     // Tier 2 — amber
  'hsl(220 15% 55%)',    // Tier 3 — neutral
  'hsl(220 15% 75%)',    // Tier 4 — light
];

function BreakdownRow({ item, unit, maxValue, tierIndex }: { item: any; unit: string; maxValue: number; tierIndex: number }) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    requestAnimationFrame(() => {
      setWidth((item.value / maxValue) * 100);
    });
  }, [item.value, maxValue]);

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-workspace-text min-w-[140px]">{item.name}</span>
      <div className="flex items-center gap-2 flex-1 justify-end">
        <div className="h-2 w-32 rounded-full bg-workspace-border/30 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.min(width, 100)}%`,
              backgroundColor: TIER_COLORS[tierIndex] || TIER_COLORS[3],
              transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          />
        </div>
        <span className="text-sm font-medium text-workspace-text tabular-nums min-w-[90px] text-right">
          {formatValue(item.value, unit)}
        </span>
      </div>
    </div>
  );
}
