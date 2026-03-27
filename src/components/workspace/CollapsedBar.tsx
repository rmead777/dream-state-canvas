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
    <div className="border-t border-workspace-border/50 bg-white/60 backdrop-blur-sm px-6 py-2.5">
      <div className="flex items-center gap-2 overflow-x-auto">
        <span className="flex-shrink-0 text-[10px] font-medium uppercase tracking-widest text-workspace-text-secondary/50 mr-1">
          Collapsed
        </span>
        {collapsed.map((obj) => (
          <button
            key={obj.id}
            onClick={() => restoreObject(obj.id)}
            className="flex-shrink-0 rounded-full border border-workspace-border bg-white px-3 py-1.5
              text-xs text-workspace-text transition-all duration-200
              hover:border-workspace-accent/30 hover:shadow-sm hover:scale-[1.02]
              active:scale-[0.98]"
          >
            <span className="text-workspace-accent mr-1.5 text-[10px]">
              {obj.type === 'metric' ? '◈' : obj.type === 'alert' ? '◆' : '◇'}
            </span>
            {obj.title}
            {obj.pinned && <span className="ml-1 text-workspace-accent">·</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
