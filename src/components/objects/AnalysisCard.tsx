/**
 * AnalysisCard — universal renderer for AI-generated structured content.
 *
 * Interprets a sections array where each section can be:
 * summary, narrative, metric, table, callout, metrics-row, chart
 *
 * The AI decides the structure; this component renders whatever it produces.
 * Unknown or malformed sections are silently skipped.
 */
import { WorkspaceObject } from '@/lib/workspace-types';
import { CardSectionType } from '@/lib/card-schema';
import MarkdownRenderer from './MarkdownRenderer';
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';

interface AnalysisCardProps {
  object: WorkspaceObject;
}

export function AnalysisCard({ object }: AnalysisCardProps) {
  const sections: CardSectionType[] = object.context?.sections || [];

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
    <div className="space-y-4">
      {sections.map((section, i) => (
        <SectionRenderer key={i} section={section} />
      ))}
      {/* Query metadata */}
      {object.context?.queryMeta?.truncated && (
        <p className="text-[10px] text-workspace-text-secondary/50 tabular-nums">
          Showing {object.context.rows?.length} of {object.context.queryMeta.totalMatched} matching rows
        </p>
      )}
    </div>
  );
}

function SectionRenderer({ section }: { section: CardSectionType }) {
  switch (section.type) {
    case 'summary': return <SummaryRenderer text={section.text} />;
    case 'narrative': return <NarrativeRenderer text={section.text} />;
    case 'metric': return <MetricRenderer section={section} />;
    case 'table': return <TableRenderer section={section} />;
    case 'callout': return <CalloutRenderer section={section} />;
    case 'metrics-row': return <MetricsRowRenderer section={section} />;
    case 'chart': return <ChartRenderer section={section} />;
    default: return null;
  }
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

function TableRenderer({ section }: { section: { columns: string[]; rows: (string | number | null)[][]; highlights?: { column: string; condition: string; style: string }[]; caption?: string } }) {
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
                  return (
                    <td key={j} className={`px-3 py-2 whitespace-nowrap ${j === 0 ? 'font-medium text-workspace-text' : 'text-workspace-text-secondary'} ${highlight || ''}`}>
                      {cell ?? '—'}
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

function ChartRenderer({ section }: { section: { chartType: string; xAxis: string; yAxis: string; data: Record<string, string | number>[]; caption?: string; color?: string; colors?: string[]; fillOpacity?: number; height?: number } }) {
  const ChartComponent = section.chartType === 'line' ? LineChart : section.chartType === 'area' ? AreaChart : BarChart;
  const DataComponent: React.ElementType = section.chartType === 'line' ? Line : section.chartType === 'area' ? Area : Bar;

  // AI can specify colors — falls back to workspace accent
  const primaryColor = section.color || 'hsl(var(--workspace-accent))';
  const chartHeight = section.height || 192;

  // Detect per-bar coloring: data items have a __color field, OR colors array matches data length
  const hasPerBarColors = section.data.some(d => '__color' in d);
  const colorsMatchDataLength = section.colors && section.colors.length === section.data.length;
  const usePerBarColoring = (hasPerBarColors || colorsMatchDataLength) && section.chartType === 'bar';

  // Multi-series: multiple y-axis columns with colors array (not matching data length = multi-series palette)
  const isMultiSeries = section.colors && !colorsMatchDataLength;
  const yAxisKeys = isMultiSeries
    ? Object.keys(section.data[0] || {}).filter(k => k !== section.xAxis && k !== '__color')
    : [section.yAxis];
  const colorPalette = (isMultiSeries && section.colors) || [primaryColor, '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

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
            <Tooltip
              contentStyle={{
                background: 'white',
                border: '1px solid hsl(var(--workspace-border))',
                borderRadius: '8px',
                fontSize: '11px',
              }}
            />
            {usePerBarColoring && barColors ? (
              <Bar dataKey={section.yAxis} fillOpacity={section.fillOpacity ?? 0.85}>
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
                  fillOpacity={section.fillOpacity ?? 0.15}
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
