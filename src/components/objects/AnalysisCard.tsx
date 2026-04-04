/**
 * AnalysisCard — universal renderer for AI-generated structured content.
 *
 * Interprets a sections array where each section can be:
 * summary, narrative, metric, table, callout, metrics-row, chart
 *
 * The AI decides the structure; this component renders whatever it produces.
 * Unknown or malformed sections are silently skipped.
 */
import { useEffect, useRef, useCallback } from 'react';
import { WorkspaceObject } from '@/lib/workspace-types';
import { CardSectionType } from '@/lib/card-schema';
import { CHART_THEMES } from '@/lib/chart-themes';
import MarkdownRenderer from './MarkdownRenderer';
import DOMPurify from 'dompurify';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell, Legend, PieChart, Pie,
  ScatterChart, Scatter, ZAxis, ComposedChart, RadialBarChart, RadialBar,
  Treemap, FunnelChart, Funnel, LabelList,
} from 'recharts';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { ENTITY_COLUMN_PATTERNS } from '@/lib/entity-extractor';

interface AnalysisCardProps {
  object: WorkspaceObject;
}

export function AnalysisCard({ object }: AnalysisCardProps) {
  const { state, dispatch } = useWorkspace();
  const highlightedEntity = state.activeContext.highlightedEntity;
  const sections: CardSectionType[] = object.context?.sections || [];

  // Check if this card contains the highlighted entity
  const isHighlighted = highlightedEntity != null && object.entityRefs?.some(
    (ref) => ref.entityName.toLowerCase() === highlightedEntity.toLowerCase()
  );

  const handleEntityClick = useCallback((entityName: string) => {
    dispatch({ type: 'HIGHLIGHT_ENTITY', payload: { entityName } });
  }, [dispatch]);

  if (sections.length === 0) {
    // Fallback: if no sections but there's content, render as narrative
    if (object.context?.content) {
      return <MarkdownRenderer content={object.context.content} />;
    }
    return (
      <p className="text-sm text-workspace-text-secondary/60">
        This analysis card has no content. Try asking Sherpa a more specific question.
      </p>
    );
  }

  return (
    <div className={`space-y-4 transition-all duration-300 ${isHighlighted ? 'ring-2 ring-workspace-accent ring-offset-2 ring-offset-workspace-bg rounded-xl p-1' : ''}`}>
      {sections.map((section, i) => (
        <SectionRenderer key={i} section={section} highlightedEntity={highlightedEntity} onEntityClick={handleEntityClick} />
      ))}
      {/* Calendar event download — shown when card has .ics content */}
      {object.context?.icsContent && (
        <CalendarDownloadButton
          icsContent={object.context.icsContent as string}
          filename={object.context.icsFilename as string || 'event.ics'}
        />
      )}
      {/* Workspace export PDF download */}
      {object.context?.reportUrl && (
        <a
          href={object.context.reportUrl as string}
          target="_blank"
          rel="noopener noreferrer"
          className="workspace-focus-ring inline-flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-red-600 active:scale-95"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download PDF Report
        </a>
      )}
      {/* Query metadata */}
      {object.context?.queryMeta?.truncated && (
        <p className="text-[10px] text-workspace-text-secondary/50 tabular-nums">
          Showing {object.context.rows?.length} of {object.context.queryMeta.totalMatched} matching rows
        </p>
      )}
    </div>
  );
}

function SectionRenderer({ section, highlightedEntity, onEntityClick }: {
  section: CardSectionType;
  highlightedEntity?: string | null;
  onEntityClick?: (name: string) => void;
}) {
  switch (section.type) {
    case 'summary': return <SummaryRenderer text={section.text} />;
    case 'narrative': return <NarrativeRenderer text={section.text} />;
    case 'metric': return <MetricRenderer section={section} />;
    case 'table': return <TableRenderer section={section} highlightedEntity={highlightedEntity} onEntityClick={onEntityClick} />;
    case 'callout': return <CalloutRenderer section={section} />;
    case 'metrics-row': return <MetricsRowRenderer section={section} />;
    case 'chart': return <ChartRenderer section={section as any} />;
    case 'vegalite': return <VegaLiteRenderer section={section as any} />;
    case 'chart-grid': return <ChartGridRenderer section={section as any} />;
    case 'embed': return <EmbedRenderer section={section as any} />;
    default: return null;
  }
}

// ─── Calendar Download Button ────────────────────────────────────────────────

function CalendarDownloadButton({ icsContent, filename }: { icsContent: string; filename: string }) {
  const handleDownload = () => {
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={handleDownload}
      className="workspace-focus-ring inline-flex items-center gap-2 rounded-lg border border-workspace-accent/30 bg-workspace-accent/8 px-4 py-2.5 text-sm font-semibold text-workspace-accent transition-all hover:bg-workspace-accent hover:text-white active:scale-95 shadow-sm"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
      Add to Calendar (.ics)
    </button>
  );
}

// ─── Section Renderers ───────────────────────────────────────────────────────

function SummaryRenderer({ text }: { text: string }) {
  return (
    <p className="text-base font-medium text-workspace-text leading-relaxed">
      {text}
    </p>
  );
}

function NarrativeRenderer({ text }: { text: string }) {
  return <MarkdownRenderer content={text} />;
}

function MetricRenderer({ section }: { section: { label: string; value: string | number; unit?: string; trend?: string; trendLabel?: string } }) {
  const trendIcon = section.trend === 'up' ? '↑' : section.trend === 'down' ? '↓' : section.trend === 'flat' ? '→' : null;
  const trendColor = section.trend === 'up' ? 'text-emerald-500' : section.trend === 'down' ? 'text-red-500' : 'text-workspace-text-secondary';

  return (
    <div className="rounded-xl border border-workspace-border/30 bg-workspace-surface/20 px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-text-secondary/60 mb-1">
        {section.label}
      </p>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-workspace-text tabular-nums">
          {section.unit && section.unit !== '%' ? section.unit : ''}{section.value}{section.unit === '%' ? '%' : ''}
        </span>
        {trendIcon && (
          <span className={`text-sm font-medium ${trendColor}`}>
            {trendIcon} {section.trendLabel || ''}
          </span>
        )}
      </div>
    </div>
  );
}


function TableRenderer({ section, highlightedEntity, onEntityClick }: {
  section: { columns: string[]; rows: (string | number | null)[][]; highlights?: { column: string; condition: string; style: string }[]; caption?: string };
  highlightedEntity?: string | null;
  onEntityClick?: (name: string) => void;
}) {
  const highlightMap = new Map<string, { condition: string; style: string }[]>();
  if (section.highlights) {
    for (const h of section.highlights) {
      const existing = highlightMap.get(h.column) || [];
      existing.push(h);
      highlightMap.set(h.column, existing);
    }
  }

  function getCellHighlight(colName: string, value: string | number | null): string | null {
    const rules = highlightMap.get(colName);
    if (!rules || value == null) return null;
    for (const rule of rules) {
      if (matchesCondition(String(value), rule.condition)) {
        return highlightStyles[rule.style] || null;
      }
    }
    return null;
  }

  return (
    <div className="space-y-1">
      <div className="overflow-x-auto rounded-lg border border-workspace-border/40">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-workspace-border bg-workspace-surface/30">
              {section.columns.map((col) => (
                <th key={col} className="px-3 py-2 text-left font-medium uppercase tracking-wider text-workspace-text-secondary/60 whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row, i) => (
              <tr key={i} className="border-b border-workspace-border/20 hover:bg-workspace-surface/20 transition-colors">
                {row.map((cell, j) => {
                  const highlight = getCellHighlight(section.columns[j], cell);
                  const colName = section.columns[j] || '';
                  const isEntityCol = ENTITY_COLUMN_PATTERNS.some((p) => p.test(colName));
                  const cellStr = cell != null ? String(cell) : null;
                  const isActiveEntity = highlightedEntity && cellStr?.toLowerCase() === highlightedEntity.toLowerCase();
                  return (
                    <td key={j} className={`px-3 py-2 whitespace-nowrap ${j === 0 ? 'font-medium text-workspace-text' : 'text-workspace-text-secondary'} ${highlight || ''}`}>
                      {isEntityCol && cellStr && onEntityClick ? (
                        <button
                          onClick={() => onEntityClick(cellStr)}
                          className={`text-left underline-offset-2 hover:underline hover:text-workspace-accent transition-colors ${isActiveEntity ? 'text-workspace-accent font-semibold' : ''}`}
                        >
                          {cellStr}
                        </button>
                      ) : (cell ?? '—')}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {section.caption && (
        <p className="text-[10px] text-workspace-text-secondary/50 px-1">{section.caption}</p>
      )}
    </div>
  );
}

const highlightStyles: Record<string, string> = {
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-red-700',
  success: 'bg-emerald-50 text-emerald-700',
  info: 'bg-blue-50 text-blue-700',
};

function matchesCondition(value: string, condition: string): boolean {
  if (condition.startsWith('>')) return parseFloat(value.replace(/[$,%,]/g, '')) > parseFloat(condition.slice(1));
  if (condition.startsWith('<')) return parseFloat(value.replace(/[$,%,]/g, '')) < parseFloat(condition.slice(1));
  if (condition.startsWith('contains:')) return value.toLowerCase().includes(condition.slice(9).toLowerCase());
  if (condition.startsWith('equals:')) return value.toLowerCase() === condition.slice(7).toLowerCase();
  return value.toLowerCase().includes(condition.toLowerCase());
}

function CalloutRenderer({ section }: { section: { severity: string; text: string } }) {
  const styles: Record<string, { border: string; bg: string; icon: string }> = {
    info: { border: 'border-blue-200', bg: 'bg-blue-50/50', icon: 'ℹ' },
    warning: { border: 'border-amber-200', bg: 'bg-amber-50/50', icon: '⚠' },
    danger: { border: 'border-red-200', bg: 'bg-red-50/50', icon: '⚡' },
    success: { border: 'border-emerald-200', bg: 'bg-emerald-50/50', icon: '✓' },
  };
  const s = styles[section.severity] || styles.info;

  return (
    <div className={`flex items-start gap-2.5 rounded-lg border-l-[3px] ${s.border} ${s.bg} px-4 py-3`}>
      <span className="text-sm mt-0.5">{s.icon}</span>
      <p className="text-xs text-workspace-text leading-relaxed">{section.text}</p>
    </div>
  );
}

/** Split jammed text+number values like "Entities10" → "10" with "Entities" as label suffix */
function cleanMetricValue(value: string | number, label: string): { display: string; labelSuffix: string } {
  if (typeof value === 'number') return { display: String(value), labelSuffix: '' };
  const str = String(value);
  // Check for text jammed with number: "Entities10", "Critical3", "USD$165,348"
  const match = str.match(/^([A-Za-z$]+)\s*(\d[\d,.$]*%?)$/);
  if (match) {
    const prefix = match[1];
    const num = match[2];
    // If prefix looks like a unit (USD, $), keep it with the number
    if (prefix === '$' || prefix === 'USD' || prefix === 'USD$') {
      return { display: `${prefix}${num}`, labelSuffix: '' };
    }
    // Otherwise the prefix is a misplaced label — show just the number
    return { display: num, labelSuffix: '' };
  }
  return { display: str, labelSuffix: '' };
}

function MetricsRowRenderer({ section }: { section: { metrics: { label: string; value: string | number; unit?: string }[] } }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {section.metrics.map((m, i) => {
        const { display } = cleanMetricValue(m.value, m.label);
        return (
          <div key={i} className="rounded-lg border border-workspace-border/30 bg-workspace-surface/15 px-3 py-2.5">
            <p className="text-[9px] font-medium uppercase tracking-[0.2em] text-workspace-text-secondary/50 mb-0.5">
              {m.label}
            </p>
            <p className="text-lg font-bold text-workspace-text tabular-nums">
              {m.unit && m.unit !== '%' ? `${m.unit} ` : ''}{display}{m.unit === '%' ? '%' : ''}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function ChartRenderer({ section }: { section: { chartType: string; xAxis: string; yAxis: string; data: Record<string, string | number>[]; caption?: string; color?: string; colors?: string[]; fillOpacity?: number; height?: number; theme?: string; zAxis?: string; innerRadius?: number; outerRadius?: number; nameKey?: string; valueKey?: string; series?: { dataKey: string; name?: string; color?: string; type?: string }[] } }) {
  // Resolve named color theme if provided, then fall back to explicit colors, then workspace accent
  const resolvedTheme = section.theme ? CHART_THEMES[section.theme] : null;
  const primaryColor = resolvedTheme?.colors[0] || section.color || 'hsl(var(--workspace-accent))';
  const chartHeight = section.height || 192;
  const defaultPalette = resolvedTheme?.colors || ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6'];

  const tooltipStyle = {
    background: 'white',
    border: '1px solid hsl(var(--workspace-border))',
    borderRadius: '8px',
    fontSize: '11px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  };

  const formatValue = (value: number) => {
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return typeof value === 'number' ? value.toLocaleString() : value;
  };

  // ─── PIE / DONUT ─────────────────────────────────────
  if (section.chartType === 'pie' || section.chartType === 'donut') {
    const nameKey = section.nameKey || section.xAxis || 'name';
    const valueKey = section.valueKey || section.yAxis || 'value';
    const innerRadius = section.chartType === 'donut' ? (section.innerRadius ?? 60) : (section.innerRadius ?? 0);
    const colors = section.colors || defaultPalette;

    return (
      <div className="space-y-1">
        <div className="w-full" style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={section.data}
                dataKey={valueKey}
                nameKey={nameKey}
                cx="50%" cy="50%"
                innerRadius={innerRadius}
                outerRadius={Math.min(chartHeight / 2 - 20, 120)}
                strokeWidth={2}
                stroke="hsl(var(--workspace-bg))"
              >
                {section.data.map((_, i) => (
                  <Cell key={i} fill={colors[i % colors.length]} />
                ))}
                <LabelList dataKey={nameKey} position="outside" style={{ fontSize: 10, fill: 'hsl(var(--workspace-text-secondary))' }} />
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatValue(value)} />
              <Legend formatter={(value) => <span style={{ fontSize: 10, color: 'hsl(var(--workspace-text-secondary))' }}>{value}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        {section.caption && <p className="text-[10px] text-workspace-text-secondary/50 px-1">{section.caption}</p>}
      </div>
    );
  }

  // ─── SCATTER ──────────────────────────────────────────
  if (section.chartType === 'scatter') {
    const zKey = section.zAxis;
    return (
      <div className="space-y-1">
        <div className="w-full" style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--workspace-border))" opacity={0.3} />
              <XAxis dataKey={section.xAxis} name={section.xAxis} tick={{ fontSize: 10 }} stroke="hsl(var(--workspace-text-secondary))" />
              <YAxis dataKey={section.yAxis} name={section.yAxis} tick={{ fontSize: 10 }} stroke="hsl(var(--workspace-text-secondary))" />
              {zKey && <ZAxis dataKey={zKey} range={[40, 400]} name={zKey} />}
              <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatValue(value)} />
              <Scatter data={section.data} fill={primaryColor} fillOpacity={0.7} strokeWidth={1} stroke={primaryColor} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        {section.caption && <p className="text-[10px] text-workspace-text-secondary/50 px-1">{section.caption}</p>}
      </div>
    );
  }

  // ─── RADIAL BAR ───────────────────────────────────────
  if (section.chartType === 'radialBar' || section.chartType === 'radial') {
    const colors = section.colors || defaultPalette;
    const dataWithFill = section.data.map((d, i) => ({ ...d, fill: colors[i % colors.length] }));
    return (
      <div className="space-y-1">
        <div className="w-full" style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart cx="50%" cy="50%" innerRadius="20%" outerRadius="90%" data={dataWithFill} startAngle={180} endAngle={0}>
              <RadialBar background={{ fill: 'hsl(var(--workspace-surface))' }} dataKey={section.yAxis || 'value'} cornerRadius={4} />
              <Legend
                iconSize={10}
                formatter={(value) => <span style={{ fontSize: 10 }}>{value}</span>}
              />
              <Tooltip contentStyle={tooltipStyle} />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
        {section.caption && <p className="text-[10px] text-workspace-text-secondary/50 px-1">{section.caption}</p>}
      </div>
    );
  }

  // ─── FUNNEL ───────────────────────────────────────────
  if (section.chartType === 'funnel') {
    const colors = section.colors || defaultPalette;
    const dataWithFill = section.data.map((d, i) => ({ ...d, fill: colors[i % colors.length] }));
    return (
      <div className="space-y-1">
        <div className="w-full" style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <FunnelChart>
              <Tooltip contentStyle={tooltipStyle} />
              <Funnel dataKey={section.yAxis || 'value'} data={dataWithFill} isAnimationActive>
                <LabelList position="right" fill="hsl(var(--workspace-text))" stroke="none" style={{ fontSize: 10 }} dataKey={section.xAxis || 'name'} />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        </div>
        {section.caption && <p className="text-[10px] text-workspace-text-secondary/50 px-1">{section.caption}</p>}
      </div>
    );
  }

  // ─── TREEMAP ──────────────────────────────────────────
  if (section.chartType === 'treemap') {
    const colors = section.colors || defaultPalette;
    const treemapData = section.data.map((d, i) => ({
      name: String(d[section.xAxis || 'name'] ?? `Item ${i + 1}`),
      size: Number(d[section.yAxis || 'value'] ?? 0),
      fill: colors[i % colors.length],
    }));
    return (
      <div className="space-y-1">
        <div className="w-full" style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={treemapData}
              dataKey="size"
              nameKey="name"
              stroke="hsl(var(--workspace-bg))"
              isAnimationActive
              content={({ x, y, width, height, name, fill }: any) => {
                if (width < 30 || height < 20) return null;
                return (
                  <g>
                    <rect x={x} y={y} width={width} height={height} fill={fill} rx={4} opacity={0.85} />
                    <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={Math.min(11, width / 6)} fontWeight={600}>
                      {String(name).length > width / 7 ? String(name).slice(0, Math.floor(width / 7)) + '…' : name}
                    </text>
                  </g>
                );
              } as any}
            />
          </ResponsiveContainer>
        </div>
        {section.caption && <p className="text-[10px] text-workspace-text-secondary/50 px-1">{section.caption}</p>}
      </div>
    );
  }

  // ─── COMPOSED (multi-type chart — bars + lines on same axes) ──────────────
  if (section.chartType === 'composed') {
    const seriesDefs = section.series || [];
    const colorPalette = section.colors || defaultPalette;
    return (
      <div className="space-y-1">
        <div className="w-full" style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={section.data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--workspace-border))" opacity={0.3} />
              <XAxis dataKey={section.xAxis} tick={{ fontSize: 10 }} stroke="hsl(var(--workspace-text-secondary))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--workspace-text-secondary))" />
              <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatValue(value)} />
              <Legend formatter={(value) => <span style={{ fontSize: 10 }}>{value}</span>} />
              {seriesDefs.map((s, i) => {
                const color = s.color || colorPalette[i % colorPalette.length];
                switch (s.type || 'bar') {
                  case 'line': return <Line key={s.dataKey} type="monotone" dataKey={s.dataKey} name={s.name || s.dataKey} stroke={color} strokeWidth={2} dot={{ r: 3 }} />;
                  case 'area': return <Area key={s.dataKey} type="monotone" dataKey={s.dataKey} name={s.name || s.dataKey} fill={color} stroke={color} fillOpacity={0.15} />;
                  default: return <Bar key={s.dataKey} dataKey={s.dataKey} name={s.name || s.dataKey} fill={color} fillOpacity={0.85} radius={[3, 3, 0, 0]} />;
                }
              })}
              {/* Fallback: if no series defined, render yAxis as bar */}
              {seriesDefs.length === 0 && <Bar dataKey={section.yAxis} fill={primaryColor} fillOpacity={0.85} radius={[3, 3, 0, 0]} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {section.caption && <p className="text-[10px] text-workspace-text-secondary/50 px-1">{section.caption}</p>}
      </div>
    );
  }

  // ─── STANDARD: BAR / LINE / AREA ─────────────────────
  const ChartComponent = section.chartType === 'line' ? LineChart : section.chartType === 'area' ? AreaChart : BarChart;
  const DataComponent: React.ElementType = section.chartType === 'line' ? Line : section.chartType === 'area' ? Area : Bar;

  // Detect per-bar coloring: data items have a __color field, OR colors array matches data length
  const hasPerBarColors = section.data.some(d => '__color' in d);
  const colorsMatchDataLength = section.colors && section.colors.length === section.data.length;
  const usePerBarColoring = (hasPerBarColors || colorsMatchDataLength) && section.chartType === 'bar';

  // Multi-series: multiple y-axis columns with colors array (not matching data length = multi-series palette)
  const isMultiSeries = section.colors && !colorsMatchDataLength;
  const yAxisKeys = isMultiSeries
    ? Object.keys(section.data[0] || {}).filter(k => k !== section.xAxis && k !== '__color')
    : [section.yAxis];
  const colorPalette = resolvedTheme?.colors || (isMultiSeries && section.colors) || [primaryColor, '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

  // Build per-bar color array
  const barColors = usePerBarColoring
    ? section.data.map((d, i) =>
        String(d.__color || (section.colors ? section.colors[i] : primaryColor) || primaryColor)
      )
    : null;

  return (
    <div className="space-y-1">
      <div className="w-full" style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <ChartComponent data={section.data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--workspace-border))" opacity={0.3} />
            <XAxis dataKey={section.xAxis} tick={{ fontSize: 10 }} stroke="hsl(var(--workspace-text-secondary))" />
            <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--workspace-text-secondary))" />
            <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatValue(value)} />
            {yAxisKeys.length > 1 && (
              <Legend formatter={(value) => <span style={{ fontSize: 10 }}>{value}</span>} />
            )}
            {usePerBarColoring && barColors ? (
              <Bar dataKey={section.yAxis} fillOpacity={section.fillOpacity ?? 0.85} radius={[3, 3, 0, 0]}>
                {barColors.map((color, i) => (
                  <Cell key={i} fill={color} stroke={color} />
                ))}
              </Bar>
            ) : (
              yAxisKeys.map((key, i) => (
                <DataComponent
                  key={key}
                  dataKey={key}
                  fill={colorPalette[i % colorPalette.length]}
                  stroke={colorPalette[i % colorPalette.length]}
                  fillOpacity={section.fillOpacity ?? (section.chartType === 'bar' ? 0.85 : 0.15)}
                  {...(section.chartType === 'bar' ? { radius: [3, 3, 0, 0] } : {})}
                  {...(section.chartType === 'line' ? { type: 'monotone', strokeWidth: 2, dot: { r: 3 } } : {})}
                />
              ))
            )}
          </ChartComponent>
        </ResponsiveContainer>
      </div>
      {section.caption && (
        <p className="text-[10px] text-workspace-text-secondary/50 px-1">{section.caption}</p>
      )}
    </div>
  );
}

// ─── Vega-Lite Renderer ───────────────────────────────────────────────────────

function VegaLiteRenderer({ section }: { section: { spec: Record<string, any>; height?: number; caption?: string; theme?: string } }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartHeight = section.height || 240;
  // Step-based specs (e.g. heatmaps) self-size by row count — don't constrain with a fixed CSS height
  const isStepSized = typeof section.spec?.height === 'object' && section.spec.height !== null;

  // Stable JSON string dep — prevents re-render when parent re-renders but spec content is unchanged
  const specJson = JSON.stringify(section.spec);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    let mounted = true;
    let vegaView: any = null;

    // Lazy-load vega-embed — keeps it out of the main bundle
    // F003: named chunk via magic comment so network tab shows "vegalite" not "embed"
    import(/* @vite-chunk-name: "vegalite" */ 'vega-embed').then(({ default: embed }) => {
      // Abort if component unmounted or container detached before async resolved
      if (!mounted || !container || !document.contains(container)) return;
      embed(container, section.spec, {
        actions: false,
        theme: 'latimes',
        config: {
          background: 'transparent',
          view: { stroke: 'transparent' },
        },
      }).then((result) => {
        if (mounted) vegaView = result;
        else result.view.finalize(); // component gone before embed finished
      }).catch((err) => {
        if (!mounted) return;
        console.warn('[VegaLiteRenderer] Failed to render spec:', err);
        if (container) {
          container.innerHTML = '<p class="text-xs text-red-400 p-2">Chart render failed</p>';
        }
      });
    }).catch(() => {
      if (!mounted) return;
      if (container) {
        container.innerHTML = '<p class="text-xs text-workspace-text-secondary/50 p-2">Vega-Lite not available</p>';
      }
    });

    return () => {
      mounted = false;
      try { vegaView?.view?.finalize(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specJson]); // specJson is stable across re-renders when content is unchanged

  return (
    <div className="space-y-1">
      <div
        ref={containerRef}
        className={`w-full ${isStepSized ? '' : 'overflow-hidden'}`}
        style={isStepSized ? { minHeight: 80 } : { height: chartHeight }}
      />
      {section.caption && (
        <p className="text-[10px] text-workspace-text-secondary/50 px-1">{section.caption}</p>
      )}
    </div>
  );
}

// ─── Chart Grid Renderer ──────────────────────────────────────────────────────

function ChartGridRenderer({ section }: { section: { columns: number; charts: any[]; caption?: string } }) {
  const cols = section.columns || 2;

  return (
    <div className="space-y-1">
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >
        {section.charts.map((chart, i) => {
          // Child charts in a grid default to a shorter height
          const childChart = { ...chart, height: chart.height ?? 160 };
          if (childChart.type === 'vegalite') {
            return <VegaLiteRenderer key={i} section={childChart} />;
          }
          return <ChartRenderer key={i} section={childChart} />;
        })}
      </div>
      {section.caption && (
        <p className="text-[10px] text-workspace-text-secondary/50 px-1">{section.caption}</p>
      )}
    </div>
  );
}

// ─── Embed Renderer ───────────────────────────────────────────────────────────

function EmbedRenderer({ section }: { section: { html: string; height?: number; caption?: string } }) {
  const sanitized = DOMPurify.sanitize(section.html, {
    USE_PROFILES: { svg: true, html: true },
  });

  return (
    <div className="space-y-1">
      <div
        className="w-full overflow-auto"
        style={{ height: section.height ? `${section.height}px` : undefined }}
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
      {section.caption && (
        <p className="text-[10px] text-workspace-text-secondary/50 px-1">{section.caption}</p>
      )}
    </div>
  );
}
