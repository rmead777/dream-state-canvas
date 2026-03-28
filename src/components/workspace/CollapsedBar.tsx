import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';

export function CollapsedBar() {
  const { state } = useWorkspace();
  const { restoreObject } = useWorkspaceActions();

  const collapsed = state.spatialLayout.peripheral
    .map((id) => state.objects[id])
    .filter(Boolean);

  if (collapsed.length === 0) return null;

  return (
    <div className="border-t border-workspace-border/50 bg-white/55 px-6 py-3 backdrop-blur-sm">
      <div className="workspace-pill flex items-center gap-2 overflow-x-auto rounded-2xl px-3 py-2.5">
        <span className="flex-shrink-0 workspace-section-label mr-1">
          Collapsed
        </span>
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-workspace-accent/10 px-1.5 text-[10px] font-medium text-workspace-accent tabular-nums">
          {collapsed.length}
        </span>
        {collapsed.map((obj) => (
          <button
            key={obj.id}
            onClick={() => restoreObject(obj.id)}
            className="flex-shrink-0 rounded-full border border-workspace-border/70 bg-white/85 px-3 py-1.5
              text-xs text-workspace-text transition-all duration-200 workspace-spring
              hover:-translate-y-0.5 hover:border-workspace-accent/30 hover:shadow-[0_10px_26px_rgba(99,102,241,0.12)]
              active:translate-y-0 active:scale-[0.985]"
          >
            <span className="text-workspace-accent mr-1.5 text-[10px]">
              {obj.type === 'metric' ? '◈' : obj.type === 'alert' ? '◆' : '◇'}
            </span>
            {obj.title}
            {obj.pinned && <span className="ml-1 text-workspace-accent">•</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
