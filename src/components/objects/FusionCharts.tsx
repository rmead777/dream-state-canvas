import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Legend,
} from 'recharts';
import { WorkspaceObject } from '@/lib/workspace-types';

const ACCENT_COLORS = [
  'hsl(220, 60%, 55%)',
  'hsl(340, 55%, 55%)',
  'hsl(160, 50%, 45%)',
  'hsl(40, 70%, 50%)',
  'hsl(270, 50%, 55%)',
];

const RISK_MAP: Record<string, number> = { Low: 1, Medium: 2, High: 3 };

interface ChartData {
  type: 'bar' | 'grouped-bar' | 'line' | 'radar';
  data: Record<string, any>[];
  keys: string[];
  labels: string;
  title: string;
}

/** Parse numeric-ish strings like "$2.4B", "2.8x", "+12.4%", "Low/Med/High" */
function parseNumeric(val: string): number | null {
  if (!val || typeof val !== 'string') return null;
  const risk = RISK_MAP[val];
  if (risk !== undefined) return risk;
  const cleaned = val.replace(/[$%xBMK,+]/g, '').trim();
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  // Scale B/M/K
  if (val.includes('B')) return n * 1000;
  if (val.includes('M')) return n;
  if (val.includes('K')) return n / 1000;
  return n;
}

function extractChartsFromObjects(sourceA: WorkspaceObject, sourceB: WorkspaceObject): ChartData[] {
  const charts: ChartData[] = [];
  const allData = collectNumericData(sourceA, sourceB);

  if (allData.length > 0) {
    // Build comparison bar chart from the richest data
    const numericKeys = Object.keys(allData[0]).filter(k => k !== 'name' && typeof allData[0][k] === 'number');

    if (numericKeys.length >= 2) {
      // Grouped bar — show multiple metrics per entity
      charts.push({
        type: 'grouped-bar',
        data: allData,
        keys: numericKeys.slice(0, 4),
        labels: 'name',
        title: 'Cross-Object Metric Comparison',
      });
    }

    if (numericKeys.length >= 3 && allData.length >= 3) {
      // Radar chart for multi-dimensional comparison
      const radarData = numericKeys.slice(0, 6).map(key => {
        const entry: Record<string, any> = { metric: formatLabel(key) };
        allData.forEach(d => {
          entry[d.name] = d[key];
        });
        return entry;
      });
      charts.push({
        type: 'radar',
        data: radarData,
        keys: allData.map(d => d.name as string),
        labels: 'metric',
        title: 'Multi-Dimensional Profile',
      });
    }
  }

  // Sparkline from metric objects
  const sparkSource = [sourceA, sourceB].find(o => o.context?.sparkline);
  if (sparkSource?.context?.sparkline) {
    const sparkData = (sparkSource.context.sparkline as number[]).map((v, i) => ({
      period: `T-${sparkSource.context.sparkline.length - i}`,
      value: v,
    }));
    charts.push({
      type: 'line',
      data: sparkData,
      keys: ['value'],
      labels: 'period',
      title: `${sparkSource.title} — Trend`,
    });
  }

  return charts;
}

function collectNumericData(a: WorkspaceObject, b: WorkspaceObject): Record<string, any>[] {
  const items: Record<string, any>[] = [];

  // From dataset/inspector rows
  for (const obj of [a, b]) {
    const ctx = obj.context;
    if (ctx?.rows && ctx?.columns) {
      const cols = ctx.columns as string[];
      for (const row of ctx.rows as string[][]) {
        const existing = items.find(i => i.name === row[0]);
        if (existing) continue;
        const entry: Record<string, any> = { name: row[0] };
        cols.forEach((col, i) => {
          if (i === 0) return;
          const n = parseNumeric(row[i]);
          if (n !== null) entry[col.toLowerCase().replace(/\s+/g, '_')] = n;
        });
        if (Object.keys(entry).length > 1) items.push(entry);
      }
    }

    // From comparison entities
    if (ctx?.entities) {
      for (const entity of ctx.entities) {
        const existing = items.find(i => i.name === entity.name);
        if (existing) continue;
        const entry: Record<string, any> = { name: entity.name };
        for (const [k, v] of Object.entries(entity.metrics || {})) {
          const n = parseNumeric(v as string);
          if (n !== null) entry[k.toLowerCase().replace(/\s+/g, '_')] = n;
        }
        if (Object.keys(entry).length > 1) items.push(entry);
      }
    }

    // From metric breakdown
    if (ctx?.breakdown) {
      for (const item of ctx.breakdown) {
        const existing = items.find(i => i.name === item.name);
        if (existing) {
          existing[obj.title.toLowerCase().replace(/\s+/g, '_')] = item.value;
        } else {
          items.push({ name: item.name, [obj.title.toLowerCase().replace(/\s+/g, '_')]: item.value });
        }
      }
    }
  }

  return items;
}

function formatLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace('Ytd', 'YTD')
    .replace('Aum', 'AUM');
}

export function FusionCharts({ sourceA, sourceB }: { sourceA: WorkspaceObject; sourceB: WorkspaceObject }) {
  const charts = extractChartsFromObjects(sourceA, sourceB);

  if (charts.length === 0) return null;

  return (
    <div className="space-y-4">
      {charts.map((chart, i) => (
        <div key={i} className="rounded-xl border border-workspace-border/30 bg-workspace-surface/20 p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-workspace-text-secondary mb-3">
            {chart.title}
          </div>
          {chart.type === 'grouped-bar' && (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chart.data} margin={{ top: 4, right: 8, bottom: 4, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 15% 90%)" />
                <XAxis dataKey={chart.labels} tick={{ fontSize: 10, fill: 'hsl(220 10% 50%)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: 'hsl(220 10% 60%)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid hsl(220 15% 90%)',
                    borderRadius: 8,
                    fontSize: 11,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                  }}
                  formatter={(value: number, name: string) => [value.toFixed(1), formatLabel(name)]}
                />
                {chart.keys.map((key, j) => (
                  <Bar key={key} dataKey={key} fill={ACCENT_COLORS[j % ACCENT_COLORS.length]} radius={[3, 3, 0, 0]} />
                ))}
                <Legend
                  formatter={(value) => <span style={{ fontSize: 9, color: 'hsl(220 10% 50%)' }}>{formatLabel(value)}</span>}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
          {chart.type === 'line' && (
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={chart.data} margin={{ top: 4, right: 8, bottom: 4, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 15% 90%)" />
                <XAxis dataKey={chart.labels} tick={{ fontSize: 9, fill: 'hsl(220 10% 60%)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: 'hsl(220 10% 60%)' }} axisLine={false} tickLine={false} domain={['dataMin - 0.2', 'dataMax + 0.2']} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid hsl(220 15% 90%)',
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                />
                <Line type="monotone" dataKey="value" stroke={ACCENT_COLORS[0]} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
          {chart.type === 'radar' && (
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={chart.data}>
                <PolarGrid stroke="hsl(220 15% 88%)" />
                <PolarAngleAxis dataKey={chart.labels} tick={{ fontSize: 9, fill: 'hsl(220 10% 50%)' }} />
                <PolarRadiusAxis tick={{ fontSize: 8, fill: 'hsl(220 10% 65%)' }} />
                {chart.keys.slice(0, 5).map((key, j) => (
                  <Radar
                    key={key}
                    name={key}
                    dataKey={key}
                    stroke={ACCENT_COLORS[j % ACCENT_COLORS.length]}
                    fill={ACCENT_COLORS[j % ACCENT_COLORS.length]}
                    fillOpacity={0.12}
                    strokeWidth={1.5}
                  />
                ))}
                <Legend formatter={(value) => <span style={{ fontSize: 9 }}>{value}</span>} />
              </RadarChart>
            </ResponsiveContainer>
          )}
        </div>
      ))}
    </div>
  );
}
