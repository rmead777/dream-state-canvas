import { WorkspaceObject } from '@/lib/workspace-types';

// Sparkline component for metric data
function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const h = 32;
  const w = 120;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(' ');

  return (
    <svg width={w} height={h} className="opacity-60">
      <polyline
        points={points}
        fill="none"
        stroke="hsl(var(--workspace-accent))"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MetricDetail({ object }: { object: WorkspaceObject }) {
  const d = object.context;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-3xl font-light tracking-tight text-workspace-text">
            {d.currentValue}{d.unit}
          </div>
          <div className="mt-1 text-xs text-workspace-text-secondary">
            {d.change > 0 ? '+' : ''}{d.change}{d.unit} over {d.changePeriod}
            <span className={`ml-2 ${d.trend === 'increasing' ? 'text-amber-600' : 'text-emerald-600'}`}>
              {d.trend === 'increasing' ? '↑ trending up' : '↓ trending down'}
            </span>
          </div>
        </div>
        {d.sparkline && <Sparkline data={d.sparkline} />}
      </div>

      {d.threshold && (
        <div className="flex gap-3 text-xs">
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">
            Warning: {d.threshold.warning}{d.unit}
          </span>
          <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">
            Critical: {d.threshold.critical}{d.unit}
          </span>
        </div>
      )}

      {d.context && (
        <p className="text-sm leading-relaxed text-workspace-text-secondary">{d.context}</p>
      )}

      {d.breakdown && (
        <div className="space-y-2 pt-2">
          <div className="text-xs font-medium uppercase tracking-wider text-workspace-text-secondary">
            Breakdown
          </div>
          {d.breakdown.map((item: any) => (
            <div key={item.name} className="flex items-center justify-between">
              <span className="text-sm text-workspace-text">{item.name}</span>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-16 rounded-full bg-workspace-surface overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${(item.value / (d.threshold?.critical || 5)) * 100}%`,
                      backgroundColor:
                        item.value >= (d.threshold?.warning || 3)
                          ? 'hsl(var(--workspace-accent))'
                          : 'hsl(220 10% 70%)',
                    }}
                  />
                </div>
                <span className="text-sm font-medium text-workspace-text">{item.value}{d.unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
