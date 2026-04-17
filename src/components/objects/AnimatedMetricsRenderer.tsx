/**
 * AnimatedMetricsRenderer — KPI dashboard with counting numbers.
 *
 * Grid of big metrics that count up from 0 → target with staggered timing.
 * Uses RAF with cubic-out easing. Frosted glass card style.
 * No Three.js — pure CSS + requestAnimationFrame.
 *
 * ALL styling is overridable by the AI via section props.
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
  labelColor?: string;
  valueColor?: string;
  labelSize?: string;
  valueSize?: string;
  subtitle?: string;
}

interface AnimatedMetricsProps {
  section: {
    metrics: AnimatedMetric[];
    columns?: number;
    caption?: string;
    // AI-controllable styling
    gap?: number;
    padding?: string;
    labelSize?: string;
    valueSize?: string;
    labelColor?: string;
    valueColor?: string;
    trendUpColor?: string;
    trendDownColor?: string;
    backgroundColor?: string;
    borderColor?: string;
    borderRadius?: string;
    stagger?: number;
    duration?: number;
    [key: string]: any;
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

  useEffect(() => {
    if (REDUCED_MOTION) { setCurrent(target); return; }

    const start = performance.now() + delay * 1000;

    const tick = (now: number) => {
      if (now < start) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const elapsed = (now - start) / 1000;
      const t = Math.min(elapsed / duration, 1);
      setCurrent(target * easeOutCubic(t));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, delay]);

  return <>{formatValue(Math.round(current), unit, prefix)}</>;
}

export function AnimatedMetricsRenderer({ section }: AnimatedMetricsProps) {
  if (!section.metrics?.length) return null;
  const cols = section.columns || Math.min(section.metrics.length, 3);
  const stagger = section.stagger ?? 0.15;
  const duration = section.duration ?? 1.2;
  const gapPx = section.gap ?? 12;

  // Section-level defaults (AI can override per-metric too).
  // Defaults must be legible on light cards without AI intervention —
  // 9px / 50% opacity secondary text was invisible on white/gray cards.
  const defaultLabelSize = section.labelSize || '11px';
  const defaultValueSize = section.valueSize || '24px';
  const defaultLabelColor = section.labelColor || 'hsl(var(--workspace-text-secondary))';
  const defaultValueColor = section.valueColor || 'hsl(var(--workspace-text))';
  const bgColor = section.backgroundColor || 'rgba(255,255,255,0.6)';
  const borderCol = section.borderColor || 'hsl(var(--workspace-border) / 0.5)';
  const borderRad = section.borderRadius || '12px';
  const padStr = section.padding || '14px 16px';
  const trendUpColor = section.trendUpColor || '#10b981';
  const trendDownColor = section.trendDownColor || '#f87171';

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gap: `${gapPx}px`,
        }}
      >
        {section.metrics.map((m, i) => {
          const delay = getStaggerDelay(i, stagger);
          const mLabelSize = m.labelSize || defaultLabelSize;
          const mValueSize = m.valueSize || defaultValueSize;
          const mLabelColor = m.labelColor || defaultLabelColor;
          const mValueColor = m.valueColor || defaultValueColor;

          const trendColor = m.trend === 'up' ? trendUpColor
            : m.trend === 'down' ? trendDownColor
            : 'hsl(var(--workspace-text-secondary) / 0.5)';
          const trendArrow = m.trend === 'up' ? '↑' : m.trend === 'down' ? '↓' : m.trend === 'flat' ? '→' : null;

          return (
            <div
              key={i}
              className="animate-[counter-enter_0.5s_cubic-bezier(0.16,1,0.3,1)_forwards] opacity-0"
              style={{
                animationDelay: `${delay}s`,
                borderRadius: borderRad,
                border: `1px solid ${borderCol}`,
                borderLeft: m.color ? `3px solid ${m.color}` : `1px solid ${borderCol}`,
                background: bgColor,
                backdropFilter: 'blur(8px)',
                padding: padStr,
              }}
            >
              <p style={{
                fontSize: mLabelSize,
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.2em',
                color: mLabelColor,
                marginBottom: '4px',
              }}>
                {m.label}
              </p>
              <p style={{
                fontSize: mValueSize,
                fontWeight: 700,
                color: mValueColor,
                lineHeight: 1.1,
                fontVariantNumeric: 'tabular-nums',
              }}>
                <CountingNumber
                  target={m.value}
                  duration={duration}
                  delay={delay}
                  unit={m.unit}
                  prefix={m.prefix}
                />
              </p>
              {m.subtitle && (
                <p style={{ fontSize: '10px', color: mLabelColor, marginTop: '2px' }}>
                  {m.subtitle}
                </p>
              )}
              {(trendArrow || m.trendValue) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                  {trendArrow && (
                    <span style={{ fontSize: '11px', fontWeight: 600, color: trendColor }}>
                      {trendArrow}
                    </span>
                  )}
                  {m.trendValue && (
                    <span style={{ fontSize: '10px', color: trendColor }}>
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
        <p style={{ fontSize: '10px', color: 'hsl(var(--workspace-text-secondary) / 0.5)', padding: '4px 4px 0', marginTop: '4px' }}>
          {section.caption}
        </p>
      )}
    </div>
  );
}
