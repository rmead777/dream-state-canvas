/**
 * SimulationCard — renders a what-if scenario comparison with a live chart.
 *
 * Context fields:
 *   metric        — metric name being simulated
 *   baseline      — calculated baseline value from actual data
 *   periodLabel   — "months" | "quarters" | "weeks"
 *   scenarioA     — { label, assumption, adjustmentPct }
 *   scenarioB     — { label, assumption, adjustmentPct }
 *   simRows       — [{ period, label, scenarioA, scenarioB }]
 */
import { useMemo } from 'react';
import { WorkspaceObject } from '@/lib/workspace-types';

interface SimRow {
  period: number;
  label: string;
  scenarioA: number;
  scenarioB: number;
}

interface ScenarioDef {
  label: string;
  assumption: string;
  adjustmentPct: number;
}

interface Props {
  object: WorkspaceObject;
}

function formatValue(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function pctBadge(pct: number) {
  const sign = pct >= 0 ? '+' : '';
  const color = pct > 0 ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : pct < 0 ? 'text-red-500 bg-red-50 border-red-200' : 'text-workspace-text-secondary bg-white border-workspace-border';
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${color}`}>
      {sign}{pct}%
    </span>
  );
}

export function SimulationCard({ object }: Props) {
  const {
    metric = 'metric',
    baseline = 0,
    periodLabel = 'months',
    scenarioA,
    scenarioB,
    simRows = [],
  } = object.context ?? {};

  const rows: SimRow[] = simRows;

  // Derive chart bounds
  const allValues = rows.flatMap((r: SimRow) => [r.scenarioA, r.scenarioB]);
  const maxVal = Math.max(...allValues, baseline, 1);
  const minVal = Math.min(...allValues, 0);
  const range = maxVal - minVal || 1;

  // Build sparkline path for SVG
  const chartW = 320;
  const chartH = 80;
  const pad = 8;

  const toX = (i: number) => pad + (i / Math.max(rows.length - 1, 1)) * (chartW - pad * 2);
  const toY = (v: number) => chartH - pad - ((v - minVal) / range) * (chartH - pad * 2);

  const pathA = rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(r.scenarioA).toFixed(1)}`).join(' ');
  const pathB = rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(r.scenarioB).toFixed(1)}`).join(' ');

  // Final period values
  const lastRow = rows[rows.length - 1];
  const finalA = lastRow?.scenarioA ?? 0;
  const finalB = lastRow?.scenarioB ?? 0;
  const deltaAB = finalB - finalA;

  const scA: ScenarioDef = scenarioA ?? { label: 'Scenario A', assumption: '', adjustmentPct: 0 };
  const scB: ScenarioDef = scenarioB ?? { label: 'Scenario B', assumption: '', adjustmentPct: 0 };

  const colLabels = useMemo(() => rows.map((r: SimRow) => r.label), [rows]);

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex items-start gap-4">
        <div className="flex-1 rounded-xl border border-workspace-border/60 bg-white/60 px-3 py-2.5 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-6 rounded-full bg-workspace-accent inline-block" />
            <span className="text-xs font-semibold text-workspace-text">{scA.label}</span>
            {pctBadge(scA.adjustmentPct)}
          </div>
          {scA.assumption && <p className="text-[11px] text-workspace-text-secondary pl-8">{scA.assumption}</p>}
        </div>
        <div className="flex-1 rounded-xl border border-workspace-border/60 bg-white/60 px-3 py-2.5 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-6 rounded-full bg-amber-400 inline-block" />
            <span className="text-xs font-semibold text-workspace-text">{scB.label}</span>
            {pctBadge(scB.adjustmentPct)}
          </div>
          {scB.assumption && <p className="text-[11px] text-workspace-text-secondary pl-8">{scB.assumption}</p>}
        </div>
      </div>

      {/* SVG sparkline chart */}
      {rows.length > 0 && (
        <div className="rounded-xl border border-workspace-border/60 bg-white/70 px-3 pt-3 pb-2 overflow-hidden">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-workspace-text-secondary/60 mb-2">
            {metric} projection · {rows.length} {periodLabel}
          </p>
          <svg viewBox={`0 0 ${chartW} ${chartH}`} width="100%" height={chartH} className="overflow-visible">
            {/* Baseline reference */}
            <line
              x1={pad} y1={toY(baseline).toFixed(1)}
              x2={chartW - pad} y2={toY(baseline).toFixed(1)}
              stroke="#94a3b8" strokeWidth="0.8" strokeDasharray="4,3"
            />
            {/* Scenario A */}
            <path d={pathA} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            {/* Scenario B */}
            <path d={pathB} fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            {/* Dots — last period */}
            {lastRow && (
              <>
                <circle cx={toX(rows.length - 1)} cy={toY(finalA)} r="4" fill="#6366f1" />
                <circle cx={toX(rows.length - 1)} cy={toY(finalB)} r="4" fill="#fbbf24" />
              </>
            )}
          </svg>
          {/* Period labels */}
          <div className="flex justify-between px-2 mt-1">
            {colLabels.filter((_: string, i: number) => i === 0 || i === Math.floor(colLabels.length / 2) || i === colLabels.length - 1).map((l: string, i: number) => (
              <span key={i} className="text-[9px] text-workspace-text-secondary/50">{l}</span>
            ))}
          </div>
        </div>
      )}

      {/* Outcome summary */}
      {lastRow && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-workspace-border/60 bg-white/60 px-3 py-2.5">
            <p className="text-[10px] text-workspace-text-secondary/60 mb-0.5">{scA.label} final</p>
            <p className="text-lg font-bold text-workspace-accent tabular-nums">{formatValue(finalA)}</p>
          </div>
          <div className="rounded-xl border border-workspace-border/60 bg-white/60 px-3 py-2.5">
            <p className="text-[10px] text-workspace-text-secondary/60 mb-0.5">{scB.label} final</p>
            <p className="text-lg font-bold text-amber-500 tabular-nums">{formatValue(finalB)}</p>
          </div>
        </div>
      )}

      {/* Delta callout */}
      {lastRow && (
        <div className={`rounded-xl border px-4 py-2.5 flex items-center gap-3 ${
          deltaAB > 0 ? 'border-emerald-200 bg-emerald-50/60' : deltaAB < 0 ? 'border-red-200 bg-red-50/60' : 'border-workspace-border bg-white/60'
        }`}>
          <span className="text-lg font-bold tabular-nums">
            {deltaAB >= 0 ? '+' : ''}{formatValue(deltaAB)}
          </span>
          <span className="text-xs text-workspace-text-secondary">
            {scB.label} vs {scA.label} after {rows.length} {periodLabel}
          </span>
        </div>
      )}

      {/* Data table — collapsed by default, toggle visible */}
      <details className="group">
        <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.18em] text-workspace-text-secondary/60 hover:text-workspace-accent transition-colors">
          Show projection table ▾
        </summary>
        <div className="mt-2 overflow-x-auto rounded-xl border border-workspace-border/60 bg-white/70">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-workspace-border/40">
                <th className="py-2 px-3 text-left font-semibold text-workspace-text-secondary/70">Period</th>
                <th className="py-2 px-3 text-right font-semibold text-workspace-accent/80">{scA.label}</th>
                <th className="py-2 px-3 text-right font-semibold text-amber-500/80">{scB.label}</th>
                <th className="py-2 px-3 text-right font-semibold text-workspace-text-secondary/70">Δ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: SimRow) => (
                <tr key={r.period} className="border-b border-workspace-border/20 last:border-0 hover:bg-workspace-accent/[0.03] transition-colors">
                  <td className="py-1.5 px-3 text-workspace-text-secondary">{r.label}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-workspace-accent tabular-nums">{formatValue(r.scenarioA)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-amber-500 tabular-nums">{formatValue(r.scenarioB)}</td>
                  <td className={`py-1.5 px-3 text-right font-mono tabular-nums ${r.scenarioB - r.scenarioA >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {r.scenarioB - r.scenarioA >= 0 ? '+' : ''}{formatValue(r.scenarioB - r.scenarioA)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
