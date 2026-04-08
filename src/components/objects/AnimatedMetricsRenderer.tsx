/**
 * AnimatedMetricsRenderer — KPI dashboard with counting numbers.
 *
 * Grid of big metrics that count up from 0 → target with staggered timing.
 * Uses RAF with cubic-out easing. Frosted glass card style.
 * No Three.js — pure CSS + requestAnimationFrame.
 */

import { useEffect, useRef, useState } from 'react';
import { easeOutCubic, getStaggerDelay } from '@/hooks/useAnimationTimeline';

interface AnimatedMetric {
  label: string;
  value: number;
  unit?: string;
  prefix?: string;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  color?: string;
}

interface AnimatedMetricsProps {
  section: {
    metrics: AnimatedMetric[];
    columns?: number;
    caption?: string;
  };
}

const REDUCED_MOTION = typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function formatValue(val: number, unit?: string, prefix?: string): string {
  const p = prefix || '';
  const u = unit || '';

  if (u === '$' || p === '$') {
    if (Math.abs(val) >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
    if (Math.abs(val) >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
    return `$${val.toLocaleString()}`;
  }

  if (u === '%') return `${val.toFixed(1)}%`;

  if (Math.abs(val) >= 1_000_000) return `${p}${(val / 1_000_000).toFixed(1)}M${u}`;
  if (Math.abs(val) >= 1_000) return `${p}${(val / 1_000).toFixed(1)}K${u}`;
  return `${p}${val.toLocaleString()}${u}`;
}

function CountingNumber({ target, duration, delay, unit, prefix }: {
  target: number;
  duration: number;
  delay: number;
  unit?: string;
  prefix?: string;
}) {
  const [current, setCurrent] = useState(REDUCED_MOTION ? target : 0);
  const rafRef = useRef(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (REDUCED_MOTION) { setCurrent(target); return; }

    const start = performance.now() + delay * 1000;
    startRef.current = start;

    const tick = (now: number) => {
      if (now < start) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const elapsed = (now - start) / 1000;
      const t = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(t);
      setCurrent(target * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, delay]);

  return <>{formatValue(Math.round(current), unit, prefix)}</>;
}

const TREND_ICONS = {
  up: { arrow: '↑', color: 'text-emerald-500' },
  down: { arrow: '↓', color: 'text-red-400' },
  flat: { arrow: '→', color: 'text-workspace-text-secondary/50' },
};

export function AnimatedMetricsRenderer({ section }: AnimatedMetricsProps) {
  const cols = section.columns || Math.min(section.metrics.length, 3);
  const stagger = 0.15;
  const duration = 1.2;

  return (
    <div className="space-y-2">
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {section.metrics.map((m, i) => {
          const delay = getStaggerDelay(i, stagger);
          const trend = m.trend ? TREND_ICONS[m.trend] : null;

          return (
            <div
              key={i}
              className="rounded-xl border border-workspace-border/30 bg-white/60 backdrop-blur-sm px-4 py-3.5 animate-[counter-enter_0.5s_cubic-bezier(0.16,1,0.3,1)_forwards] opacity-0"
              style={{
                animationDelay: `${delay}s`,
                borderLeft: m.color ? `3px solid ${m.color}` : undefined,
              }}
            >
              <p className="text-[9px] font-medium uppercase tracking-[0.2em] text-workspace-text-secondary/50 mb-1">
                {m.label}
              </p>
              <p className="text-2xl font-bold text-workspace-text tabular-nums leading-tight">
                <CountingNumber
                  target={m.value}
                  duration={duration}
                  delay={delay}
                  unit={m.unit}
                  prefix={m.prefix}
                />
              </p>
              {(trend || m.trendValue) && (
                <div className="flex items-center gap-1 mt-1">
                  {trend && (
                    <span className={`text-[11px] font-semibold ${trend.color}`}>
                      {trend.arrow}
                    </span>
                  )}
                  {m.trendValue && (
                    <span className={`text-[10px] ${trend?.color || 'text-workspace-text-secondary/50'}`}>
                      {m.trendValue}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {section.caption && (
        <p className="text-[10px] text-workspace-text-secondary/50 px-1">{section.caption}</p>
      )}
    </div>
  );
}
