import { useState } from 'react';
import { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import { WorkspaceObject as WO } from '@/lib/workspace-types';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCrossObjectBehavior } from '@/hooks/useCrossObjectBehavior';
import { MetricDetail } from '@/components/objects/MetricDetail';
import { ComparisonPanel } from '@/components/objects/ComparisonPanel';
import { AlertRiskPanel } from '@/components/objects/AlertRiskPanel';
import { DataInspector } from '@/components/objects/DataInspector';
import { AIBrief } from '@/components/objects/AIBrief';
import { Timeline } from '@/components/objects/Timeline';

const typeLabels: Record<string, string> = {
  metric: 'Metric',
  comparison: 'Comparison',
  alert: 'Alert',
  inspector: 'Data',
  brief: 'Brief',
  timeline: 'Timeline',
  monitor: 'Monitor',
};

function ObjectContent({ object }: { object: WO }) {
  switch (object.type) {
    case 'metric': return <MetricDetail object={object} />;
    case 'comparison': return <ComparisonPanel object={object} />;
    case 'alert': return <AlertRiskPanel object={object} />;
    case 'inspector': return <DataInspector object={object} />;
    case 'brief': return <AIBrief object={object} />;
    case 'timeline': return <Timeline object={object} />;
    default: return <div className="text-sm text-workspace-text-secondary">Unknown object type</div>;
  }
}

export function WorkspaceObjectWrapper({ object, dragListeners }: { object: WO; dragListeners?: SyntheticListenerMap }) {
  const { collapseObject, dissolveObject, pinObject, unpinObject, focusObject, processIntent } = useWorkspaceActions();
  const { state } = useWorkspace();
  const { shouldDim, shouldHighlight, getContextualActions, cascadeDissolve } = useCrossObjectBehavior();
  const [size, setSize] = useState<{ width: number | null; height: number | null }>({ width: null, height: null });

  const isFocused = state.activeContext.focusedObjectId === object.id;
  const isDimmed = shouldDim(object.id);
  const isHighlighted = shouldHighlight(object.id);
  const isMaterializing = object.status === 'materializing';
  const contextualActions = getContextualActions(object.id);

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
      className={`
        group relative rounded-xl border bg-white
        transition-all duration-500
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
      style={height ? { height: `${height}px`, overflow: 'auto' } : undefined}
      onClick={() => focusObject(object.id)}
    >
      {/* Relationship highlight pulse */}
      {isHighlighted && (
        <div className="absolute inset-0 rounded-xl bg-workspace-accent/[0.02] animate-pulse pointer-events-none" />
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

      {/* Content */}
      <div className="px-5 pb-4">
        <ObjectContent object={object} />
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

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-ns-resize opacity-0 group-hover:opacity-40 transition-opacity flex items-end justify-end pr-1 pb-1"
        title="Drag to resize"
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          const startY = e.clientY;
          const startH = (e.currentTarget.parentElement?.getBoundingClientRect().height) ?? 200;
          const onMove = (ev: MouseEvent) => {
            const newH = Math.max(120, startH + ev.clientY - startY);
            setHeight(newH);
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
    </div>
  );
}
