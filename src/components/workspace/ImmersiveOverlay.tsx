import { useWorkspace } from '@/contexts/WorkspaceContext';
import { DocumentReader } from '@/components/objects/DocumentReader';
import { DatasetView } from '@/components/objects/DatasetView';

/**
 * ImmersiveOverlay — a depth layer, not a page navigation.
 * When a user goes deep into a document or dataset, this overlay
 * expands to fill the workspace while other objects fade.
 */
export function ImmersiveOverlay() {
  const { state, dispatch } = useWorkspace();
  const { immersiveObjectId } = state.activeContext;

  if (!immersiveObjectId) return null;

  const object = state.objects[immersiveObjectId];
  if (!object || object.status === 'dissolved') return null;

  const handleClose = () => {
    dispatch({ type: 'EXIT_IMMERSIVE' });
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-[linear-gradient(to_bottom,rgba(255,255,255,0.96),rgba(248,248,252,0.96))] backdrop-blur-md animate-[immersive-enter_0.4s_cubic-bezier(0.16,1,0.3,1)_forwards]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(to_bottom,rgba(99,102,241,0.08),transparent)]" />

      {/* Minimal header */}
      <div className="relative z-10 flex items-center justify-between px-8 py-4 border-b border-workspace-border/30 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={handleClose}
            className="workspace-pill rounded-full px-3.5 py-2 text-xs text-workspace-text-secondary transition-all duration-200 workspace-spring hover:-translate-y-0.5 hover:text-workspace-text"
          >
            ← Back to workspace
          </button>
          <div className="h-4 w-px bg-workspace-border/50" />
          <span className="workspace-pill rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent">
            {object.type === 'document' ? 'Document' : 'Dataset'}
          </span>
          <div>
            <h2 className="text-sm font-semibold text-workspace-text">{object.title}</h2>
            <p className="text-[11px] text-workspace-text-secondary/60">Immersive mode</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClose}
            className="workspace-pill rounded-full p-2 text-workspace-text-secondary transition-colors hover:text-workspace-text"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Immersive content */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 pt-3 pb-4">
        {object.type === 'document' ? (
          <DocumentReader object={object} isImmersive />
        ) : object.type === 'dataset' ? (
          <DatasetView object={object} isImmersive />
        ) : null}
      </div>
    </div>
  );
}
