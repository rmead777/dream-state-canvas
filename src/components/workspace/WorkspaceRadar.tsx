/**
 * WorkspaceRadar — at-a-glance health indicators for the workspace.
 *
 * Shows 3-4 horizontal bars measuring workspace quality metrics.
 * Stores previous values in localStorage for trend delta display.
 *
 * Pattern from Solar Insight's PortfolioRadar.
 */
import { useMemo, useEffect, useRef } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useDocuments } from '@/contexts/DocumentContext';

const STORAGE_KEY = 'workspace-radar-prev';

interface RadarMetric {
  label: string;
  value: number; // 0-100
  delta: number | null; // vs previous, null if no prev
  color: string;
}

export function WorkspaceRadar() {
  const { state } = useWorkspace();
  const { documents } = useDocuments();
  const prevRef = useRef<Record<string, number>>({});

  // Load previous values
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) prevRef.current = JSON.parse(stored);
    } catch {}
  }, []);

  const metrics = useMemo<RadarMetric[]>(() => {
    const activeObjects = Object.values(state.objects).filter(o => o.status !== 'dissolved');
    const prev = prevRef.current;

    // 1. Coverage: what % of object types have been explored?
    const usedTypes = new Set(activeObjects.map(o => o.type));
    const coverageScore = Math.min(100, Math.round((usedTypes.size / 6) * 100)); // 6 types = full coverage

    // 2. Data freshness: how recently was the last document uploaded?
    const latestDoc = documents.length > 0
      ? Math.max(...documents.map(d => new Date(d.created_at).getTime()))
      : 0;
    const hoursSinceUpload = latestDoc > 0 ? (Date.now() - latestDoc) / (1000 * 60 * 60) : 999;
    const freshnessScore = hoursSinceUpload < 1 ? 100
      : hoursSinceUpload < 24 ? 80
      : hoursSinceUpload < 72 ? 50
      : hoursSinceUpload < 168 ? 25
      : 0;

    // 3. Workspace density: are we using the canvas effectively?
    const densityScore = Math.min(100, Math.round((activeObjects.length / 4) * 100));

    // 4. Memory health: does Sherpa have memories to work with?
    const memoryCount = parseInt(localStorage.getItem('sherpa-memory-count') || '0');
    const memoryScore = Math.min(100, memoryCount * 20); // 5+ memories = 100%

    const values: Record<string, number> = {
      coverage: coverageScore,
      freshness: freshnessScore,
      density: densityScore,
      memory: memoryScore,
    };

    // Save current values for next delta comparison
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values));

    const getDelta = (key: string, current: number): number | null => {
      if (prev[key] === undefined) return null;
      return current - prev[key];
    };

    return [
      { label: 'Coverage', value: coverageScore, delta: getDelta('coverage', coverageScore), color: 'bg-indigo-500' },
      { label: 'Data Freshness', value: freshnessScore, delta: getDelta('freshness', freshnessScore), color: 'bg-emerald-500' },
      { label: 'Canvas Density', value: densityScore, delta: getDelta('density', densityScore), color: 'bg-amber-500' },
      { label: 'Memory Health', value: memoryScore, delta: getDelta('memory', memoryScore), color: 'bg-violet-500' },
    ];
  }, [state.objects, documents]);

  return (
    <div className="space-y-2">
      <div className="text-[9px] uppercase tracking-[0.2em] text-workspace-text-secondary/40 font-medium">
        Workspace Health
      </div>
      {metrics.map(m => (
        <div key={m.label} className="space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-workspace-text-secondary/70">{m.label}</span>
            <span className="text-[10px] tabular-nums text-workspace-text-secondary/50 flex items-center gap-1">
              {m.value}%
              {m.delta !== null && m.delta !== 0 && (
                <span className={m.delta > 0 ? 'text-emerald-500' : 'text-red-400'}>
                  {m.delta > 0 ? '↑' : '↓'}{Math.abs(m.delta)}
                </span>
              )}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-workspace-border/30 overflow-hidden">
            <div
              className={`h-full rounded-full ${m.color} transition-all duration-700 ease-spring-smooth`}
              style={{ width: `${m.value}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
