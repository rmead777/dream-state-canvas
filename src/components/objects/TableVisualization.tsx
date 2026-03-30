import { useMemo } from 'react';
import {
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
} from 'recharts';
import { ObjectViewState } from '@/lib/workspace-intelligence';

interface TableVisualizationProps {
  columns: string[];
  rows: string[][];
  view: ObjectViewState;
  title?: string;
}

function parseNumeric(value: string): number | null {
  const normalized = value.replace(/[$,%]/g, '').replace(/,/g, '').trim();
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function inferXAxis(columns: string[], rows: string[][], view: ObjectViewState): string | null {
  if (view.chartXAxis && columns.includes(view.chartXAxis)) return view.chartXAxis;
  const preferred = view.preferredColumns?.find((column) => columns.includes(column));
  if (preferred) return preferred;

  return columns.find((column, index) => rows.some((row) => parseNumeric(String(row[index] ?? '')) === null)) || columns[0] || null;
}

function inferYAxis(columns: string[], rows: string[][], view: ObjectViewState): string | null {
  if (view.chartYAxis && columns.includes(view.chartYAxis)) return view.chartYAxis;
  if (view.sortBy && columns.includes(view.sortBy)) return view.sortBy;

  return columns.find((column, index) => rows.some((row) => parseNumeric(String(row[index] ?? '')) !== null)) || null;
}

export function TableVisualization({ columns, rows, view, title }: TableVisualizationProps) {
  const chart = useMemo(() => {
    const xColumn = inferXAxis(columns, rows, view);
    const yColumn = inferYAxis(columns, rows, view);
    if (!xColumn || !yColumn) return null;

    const xIndex = columns.indexOf(xColumn);
    const yIndex = columns.indexOf(yColumn);
    if (xIndex < 0 || yIndex < 0) return null;

    const grouped = new Map<string, number>();
    for (const row of rows) {
      const xValue = String(row[xIndex] ?? '').trim();
      const yValue = parseNumeric(String(row[yIndex] ?? ''));
      if (!xValue || yValue === null) continue;
      grouped.set(xValue, (grouped.get(xValue) || 0) + yValue);
    }

    const data = [...grouped.entries()]
      .slice(0, 12)
      .map(([label, value]) => ({ label, value }));

    if (data.length < 2) return null;

    return {
      xColumn,
      yColumn,
      type: view.chartType || 'bar',
      data,
    };
  }, [columns, rows, view]);

  if (!chart) {
    return (
      <div className="workspace-card-surface flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-2xl border border-workspace-border/45 px-5 py-6 text-center">
        <span className="workspace-pill rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/75">
          Chart view
        </span>
        <p className="text-sm font-medium text-workspace-text">Not enough structured numeric data to chart this view</p>
        <p className="max-w-[34ch] text-xs leading-5 text-workspace-text-secondary/75">
          Try switching back to table view or ask Sherpa to chart a numeric column against a categorical one.
        </p>
      </div>
    );
  }

  const chartStroke = view.chartColor || 'rgba(99,102,241,0.92)';
  const chartFill = view.chartColor || 'rgba(99,102,241,0.82)';

  const commonProps = {
    data: chart.data,
    margin: { top: 8, right: 8, left: -16, bottom: 0 },
  };

  return (
    <div className="workspace-card-surface rounded-2xl border border-workspace-border/45 px-4 py-4">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/75">
            {chart.type} chart
          </div>
          <div className="mt-1 text-sm font-medium text-workspace-text">
            {title || 'Structured view'}
          </div>
        </div>
        <div className="text-right text-[11px] text-workspace-text-secondary">
          <div>{chart.yColumn}</div>
          <div className="mt-1 text-workspace-text-secondary/60">by {chart.xColumn}</div>
        </div>
      </div>

      <div style={{ height: view.chartHeight || 224 }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chart.type === 'line' ? (
            <LineChart {...commonProps}>
              <CartesianGrid stroke="rgba(148, 163, 184, 0.18)" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'rgba(71, 85, 105, 0.8)', fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: 'rgba(71, 85, 105, 0.8)', fontSize: 11 }} width={56} />
              <Tooltip contentStyle={{ borderRadius: 16, border: '1px solid rgba(99,102,241,0.12)', boxShadow: '0 18px 50px rgba(15,23,42,0.08)' }} />
              <Line type="monotone" dataKey="value" stroke={chartStroke} strokeWidth={3} dot={{ r: 3, fill: chartStroke }} activeDot={{ r: 5 }} />
            </LineChart>
          ) : chart.type === 'area' ? (
            <AreaChart {...commonProps}>
              <defs>
                <linearGradient id="workspaceArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartStroke} stopOpacity={0.45} />
                  <stop offset="95%" stopColor={chartStroke} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(148, 163, 184, 0.18)" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'rgba(71, 85, 105, 0.8)', fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: 'rgba(71, 85, 105, 0.8)', fontSize: 11 }} width={56} />
              <Tooltip contentStyle={{ borderRadius: 16, border: '1px solid rgba(99,102,241,0.12)', boxShadow: '0 18px 50px rgba(15,23,42,0.08)' }} />
              <Area type="monotone" dataKey="value" stroke={chartStroke} strokeWidth={3} fill="url(#workspaceArea)" fillOpacity={view.chartFillOpacity ?? 1} />
            </AreaChart>
          ) : (
            <BarChart {...commonProps}>
              <CartesianGrid stroke="rgba(148, 163, 184, 0.18)" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'rgba(71, 85, 105, 0.8)', fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: 'rgba(71, 85, 105, 0.8)', fontSize: 11 }} width={56} />
              <Tooltip contentStyle={{ borderRadius: 16, border: '1px solid rgba(99,102,241,0.12)', boxShadow: '0 18px 50px rgba(15,23,42,0.08)' }} />
              <Bar dataKey="value" fill={chartFill} radius={[10, 10, 4, 4]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
