import { useState, useEffect, useRef } from 'react';
import { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import { WorkspaceObject as WO } from '@/lib/workspace-types';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCrossObjectBehavior } from '@/hooks/useCrossObjectBehavior';
import { useAmbientSherpa } from '@/hooks/useAmbientSherpa';
import { AmbientHint } from '@/components/workspace/AmbientHint';
import { MetricDetail } from '@/components/objects/MetricDetail';
import { ComparisonPanel } from '@/components/objects/ComparisonPanel';
import { AlertRiskPanel } from '@/components/objects/AlertRiskPanel';
import { DataInspector } from '@/components/objects/DataInspector';
import { AIBrief } from '@/components/objects/AIBrief';
import { Timeline } from '@/components/objects/Timeline';
import { DocumentReader } from '@/components/objects/DocumentReader';
import { DatasetView } from '@/components/objects/DatasetView';

const typeLabels: Record<string, string> = {
  metric: 'Metric',
  comparison: 'Comparison',
  alert: 'Alert',
  inspector: 'Data',
  brief: 'Brief',
  timeline: 'Timeline',
  monitor: 'Monitor',
  document: 'Document',
  dataset: 'Dataset',
};

function ObjectContent({ object }: { object: WO }) {
  switch (object.type) {
    case 'metric': return <MetricDetail object={object} />;
    case 'comparison': return <ComparisonPanel object={object} />;
    case 'alert': return <AlertRiskPanel object={object} />;
    case 'inspector': return <DataInspector object={object} />;
    case 'brief': return <AIBrief object={object} />;
    case 'timeline': return <Timeline object={object} />;
    case 'document': return <DocumentReader object={object} />;
    case 'dataset': return <DatasetView object={object} />;
    default: return <div className="text-sm text-workspace-text-secondary">Unknown object type</div>;
  }
}

export function WorkspaceObjectWrapper({ object, dragListeners }: { object: WO; dragListeners?: SyntheticListenerMap }) {
  const { collapseObject, dissolveObject, pinObject, unpinObject, focusObject, processIntent } = useWorkspaceActions();
  const { state } = useWorkspace();
  const { shouldDim, shouldHighlight, getContextualActions, cascadeDissolve } = useCrossObjectBehavior();
  const ambientHints = useAmbientSherpa();
  const [size, setSize] = useState<{ width: number | null; height: number | null }>({ width: null, height: null });
  const [dismissedHints, setDismissedHints] = useState<Set<string>>(new Set());
  const [showFocusFlash, setShowFocusFlash] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const isFocused = state.activeContext.focusedObjectId === object.id;

  // Scroll into view when focused
  useEffect(() => {
    if (isFocused && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isFocused]);

  // Sherpa-driven focus flash / glow
  useEffect(() => {
    if (!isFocused) return;

    setShowFocusFlash(true);
    const timeout = window.setTimeout(() => setShowFocusFlash(false), 900);
    return () => window.clearTimeout(timeout);
  }, [isFocused, object.lastInteractedAt]);

  const isDimmed = shouldDim(object.id);
  const isHighlighted = shouldHighlight(object.id);
  const isMaterializing = object.status === 'materializing';
  const contextualActions = getContextualActions(object.id);
  const objectHints = ambientHints.filter((h) => h.objectId === object.id && !dismissedHints.has(h.hint));

  const handleDissolve = (e: React.MouseEvent) => {
    e.stopPropagation();
    const cascadeTargets = cascadeDissolve(object.id);
    for (const childId of cascadeTargets) {
      dissolveObject(childId);
    }
    dissolveObject(object.id);
  };

  return (
    <div
      ref={cardRef}
      className={`
        group relative rounded-xl border bg-white
        transition-all duration-500
        ${size.height ? 'flex flex-col' : ''}
        ${isMaterializing
          ? 'animate-[materialize_0.4s_cubic-bezier(0.16,1,0.3,1)_forwards] opacity-0'
          : 'opacity-100'
        }
        ${isFocused
          ? 'border-workspace-accent/20 shadow-[0_4px_24px_rgba(0,0,0,0.06)] scale-[1.01]'
          : isHighlighted
            ? 'border-workspace-accent/15 shadow-[0_2px_16px_rgba(0,0,0,0.04)] ring-1 ring-workspace-accent/10'
            : isDimmed
              ? 'border-workspace-border opacity-65 shadow-sm'
              : 'border-workspace-border shadow-[0_2px_12px_rgba(0,0,0,0.04)]'
        }
      `}
      style={{
        ...(size.width ? { width: size.width } : {}),
        ...(size.height ? { height: size.height } : {}),
      }}
      onClick={() => focusObject(object.id)}
    >
      {/* Relationship highlight pulse */}
      {isHighlighted && (
        <div className="absolute inset-0 rounded-xl bg-workspace-accent/[0.02] animate-pulse pointer-events-none" />
      )}

      {/* Sherpa focus flash */}
      {showFocusFlash && (
        <div className="pointer-events-none absolute inset-0 rounded-xl border border-workspace-accent/30 bg-workspace-accent-subtle/40 animate-enter" />
      )}

      {/* Header — actions appear on hover only (anti-drift: no always-visible action bars) */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          {/* Drag handle */}
          <span
            {...dragListeners}
            className="cursor-grab text-workspace-text-secondary/30 hover:text-workspace-text-secondary/60 transition-colors active:cursor-grabbing select-none"
            title="Drag to reorder"
          >
            ⠿
          </span>
          <span className="text-[10px] font-medium uppercase tracking-widest text-workspace-accent">
            {typeLabels[object.type] || object.type}
          </span>
          <h3 className="text-sm font-semibold text-workspace-text">{object.title}</h3>
          {object.relationships.length > 0 && (
            <span className="text-[9px] text-workspace-accent/40" title="Has relationships">
              ◈ {object.relationships.length}
            </span>
          )}
        </div>

        {/* Contextual actions — visible on hover */}
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={(e) => { e.stopPropagation(); object.pinned ? unpinObject(object.id) : pinObject(object.id); }}
            className={`rounded-md px-2 py-1 text-[10px] transition-colors ${
              object.pinned
                ? 'bg-workspace-accent/10 text-workspace-accent'
                : 'text-workspace-text-secondary hover:bg-workspace-surface'
            }`}
            title={object.pinned ? 'Unpin' : 'Pin'}
          >
            {object.pinned ? '◆ Pinned' : '◇ Pin'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); collapseObject(object.id); }}
            className="rounded-md px-2 py-1 text-[10px] text-workspace-text-secondary transition-colors hover:bg-workspace-surface"
            title="Collapse"
          >
            ↓ Collapse
          </button>
          <button
            onClick={handleDissolve}
            className="rounded-md px-2 py-1 text-[10px] text-workspace-text-secondary transition-colors hover:bg-workspace-surface hover:text-red-500"
            title="Dissolve"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content — scrollable when height is constrained */}
      <div className={`px-5 pb-4 ${size.height ? 'overflow-y-auto flex-1 min-h-0' : ''}`}
        style={size.height ? { maxHeight: `calc(100% - 100px)` } : {}}
      >
        <ObjectContent object={object} />

        {/* Ambient Sherpa hints — contextual, inline */}
        {objectHints.map((h) => (
          <AmbientHint
            key={h.hint}
            hint={h.hint}
            acceptLabel={h.acceptLabel}
            onDismiss={() => setDismissedHints((prev) => new Set(prev).add(h.hint))}
            onAccept={
              h.action === 'pin' ? () => { pinObject(object.id); setDismissedHints((prev) => new Set(prev).add(h.hint)); }
              : h.action === 'collapse' ? () => { collapseObject(object.id); }
              : undefined
            }
            delay={2000}
          />
        ))}
      </div>

      {/* Cross-object contextual actions — appear on hover */}
      {contextualActions.length > 0 && (
        <div className="border-t border-workspace-border/20 px-5 py-2 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="flex items-center gap-2">
            {contextualActions.map((action) => (
              <button
                key={action.id}
                onClick={(e) => {
                  e.stopPropagation();
                  if (action.query) processIntent(action.query);
                }}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-workspace-text-secondary
                  transition-colors hover:bg-workspace-accent-subtle/40 hover:text-workspace-accent"
              >
                <span>{action.icon}</span>
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Origin trace — subtle, bottom */}
      {object.origin.query && (
        <div className="border-t border-workspace-border/30 px-5 py-2 text-[10px] text-workspace-text-secondary/60">
          ← "{object.origin.query}"
        </div>
      )}

      {/* Bottom edge — vertical resize only */}
      <div
        className="absolute bottom-0 inset-x-4 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
        title="Drag to resize height"
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          const startY = e.clientY;
          const rect = e.currentTarget.parentElement?.getBoundingClientRect();
          const startH = rect?.height ?? 200;
          const onMove = (ev: MouseEvent) => {
            setSize((prev) => ({
              width: prev.width,
              height: Math.max(100, startH + ev.clientY - startY),
            }));
          };
          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
      >
        <div className="mx-auto w-8 h-1 rounded-full bg-workspace-text-secondary/20 mt-0.5" />
      </div>

      {/* Corner — diagonal resize (width + height) */}
      <div
        className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize opacity-0 group-hover:opacity-40 transition-opacity flex items-end justify-end pr-1 pb-1 z-20"
        title="Drag to resize"
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;
          const rect = e.currentTarget.parentElement?.getBoundingClientRect();
          const startW = rect?.width ?? 400;
          const startH = rect?.height ?? 200;
          const onMove = (ev: MouseEvent) => {
            setSize({
              width: Math.max(280, startW + ev.clientX - startX),
              height: Math.max(100, startH + ev.clientY - startY),
            });
          };
          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
      >
        <svg width="8" height="8" viewBox="0 0 8 8" className="text-workspace-text-secondary">
          <path d="M7 1L1 7M7 4L4 7M7 7L7 7" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </div>

      {/* Double-click bottom edge to reset height */}
      <div
        className="absolute bottom-0 inset-x-0 h-1 z-[5]"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setSize((prev) => ({ width: prev.width, height: null }));
        }}
      />
    </div>
  );
}
