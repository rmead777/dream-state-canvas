import { WorkspaceObject as WO } from '@/lib/workspace-types';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { useWorkspace } from '@/contexts/WorkspaceContext';
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

export function WorkspaceObjectWrapper({ object }: { object: WO }) {
  const { collapseObject, dissolveObject, pinObject, unpinObject, focusObject } = useWorkspaceActions();
  const { state } = useWorkspace();
  const isFocused = state.activeContext.focusedObjectId === object.id;
  const hasFocusedSibling = state.activeContext.focusedObjectId !== null && !isFocused;

  const isMaterializing = object.status === 'materializing';

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
          : hasFocusedSibling
            ? 'border-workspace-border opacity-60 shadow-sm'
            : 'border-workspace-border shadow-[0_2px_12px_rgba(0,0,0,0.04)]'
        }
      `}
      onClick={() => focusObject(object.id)}
    >
      {/* Header — actions appear on hover only (anti-drift: no always-visible action bars) */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-medium uppercase tracking-widest text-workspace-accent">
            {typeLabels[object.type] || object.type}
          </span>
          <h3 className="text-sm font-semibold text-workspace-text">{object.title}</h3>
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
            onClick={(e) => { e.stopPropagation(); dissolveObject(object.id); }}
            className="rounded-md px-2 py-1 text-[10px] text-workspace-text-secondary transition-colors hover:bg-workspace-surface hover:text-red-500"
            title="Dissolve"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-5 pb-5">
        <ObjectContent object={object} />
      </div>

      {/* Origin trace — subtle, bottom */}
      {object.origin.query && (
        <div className="border-t border-workspace-border/30 px-5 py-2 text-[10px] text-workspace-text-secondary/60">
          ← "{object.origin.query}"
        </div>
      )}
    </div>
  );
}
