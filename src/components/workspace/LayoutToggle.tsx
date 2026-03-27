import { useWorkspace } from '@/contexts/WorkspaceContext';

export function LayoutToggle() {
  const { state, dispatch } = useWorkspace();
  const isAuto = state.layoutMode === 'auto';

  return (
    <button
      onClick={() =>
        dispatch({
          type: 'SET_LAYOUT_MODE',
          payload: isAuto ? 'freeform' : 'auto',
        })
      }
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full border border-workspace-border bg-white/80 backdrop-blur-sm px-4 py-2 text-[11px] font-medium text-workspace-text-secondary shadow-sm transition-all hover:shadow-md hover:border-workspace-accent/30"
      title={isAuto ? 'Switch to freeform canvas' : 'Switch to auto layout'}
    >
      <span className="text-workspace-accent">
        {isAuto ? '⊞' : '≡'}
      </span>
      {isAuto ? 'Freeform' : 'Auto layout'}
    </button>
  );
}
