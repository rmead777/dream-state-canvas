import { useEffect, useRef, useState } from 'react';
import { WorkspaceObject } from '@/lib/workspace-types';

// Animated sparkline with draw-in effect
function Sparkline({ data }: { data: number[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let start: number | null = null;
    const duration = 800;
    const animate = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      setProgress(p);
      if (p < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, []);

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const h = 32;
  const w = 120;
  const visibleCount = Math.ceil(data.length * progress);
  const points = data
    .slice(0, visibleCount)
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(' ');

  return (
    <svg ref={svgRef} width={w} height={h} className="opacity-80">
      <polyline
        points={points}
        fill="none"
        stroke="hsl(var(--workspace-accent))"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Live pulse dot at the end */}
      {visibleCount > 0 && progress >= 1 && (
        <circle
          cx={(visibleCount - 1) / (data.length - 1) * w}
          cy={h - ((data[visibleCount - 1] - min) / range) * h}
          r="2.5"
          fill="hsl(var(--workspace-accent))"
          className="animate-pulse"
        />
      )}
    </svg>
  );
}

// Count-up animation for metric values
function AnimatedValue({ value, unit }: { value: string; unit: string }) {
  const numericMatch = value.match(/^(\d+\.?\d*)/);
  const [display, setDisplay] = useState(numericMatch ? '0' : value);

  useEffect(() => {
    if (!numericMatch) {
      setDisplay(value);
      return;
    }

    const target = parseFloat(numericMatch[1]);
    const suffix = value.slice(numericMatch[0].length);
    const duration = 600;
    let start: number | null = null;

    const animate = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      const current = target * eased;
      setDisplay(
        (Number.isInteger(target) ? Math.round(current).toString() : current.toFixed(1)) + suffix
      );
      if (p < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [value]);

  return <>{display}{unit}</>;
}

export function MetricDetail({ object }: { object: WorkspaceObject }) {
  const d = object.context;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-3xl font-light tracking-tight text-workspace-text">
            <AnimatedValue value={String(d.currentValue)} unit={d.unit} />
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
            <BreakdownRow key={item.name} item={item} unit={d.unit} threshold={d.threshold} />
          ))}
        </div>
      )}

      {/* Last updated pulse */}
      <div className="flex items-center gap-2 pt-1">
        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[10px] text-workspace-text-secondary/40">Live</span>
      </div>
    </div>
  );
}

function BreakdownRow({ item, unit, threshold }: { item: any; unit: string; threshold: any }) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    requestAnimationFrame(() => {
      setWidth((item.value / (threshold?.critical || 5)) * 100);
    });
  }, [item.value, threshold]);

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-workspace-text">{item.name}</span>
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-20 rounded-full bg-workspace-border/50 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${Math.min(width, 100)}%`,
              backgroundColor:
                item.value >= (threshold?.warning || 3)
                  ? 'hsl(var(--workspace-accent))'
                  : 'hsl(220 15% 55%)',
            }}
          />
        </div>
        <span className="text-sm font-medium text-workspace-text">{item.value}{unit}</span>
      </div>
    </div>
  );
}
