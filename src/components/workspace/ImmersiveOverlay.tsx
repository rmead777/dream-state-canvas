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
    <div className="fixed inset-0 z-[60] flex flex-col bg-workspace-bg/98 backdrop-blur-sm animate-[immersive-enter_0.4s_cubic-bezier(0.16,1,0.3,1)_forwards]">
      {/* Minimal header */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-workspace-border/30">
        <div className="flex items-center gap-3">
          <button
            onClick={handleClose}
            className="rounded-lg px-3 py-1.5 text-xs text-workspace-text-secondary transition-colors hover:bg-workspace-surface hover:text-workspace-text"
          >
            ← Back to workspace
          </button>
          <div className="h-4 w-px bg-workspace-border/50" />
          <span className="text-[10px] font-medium uppercase tracking-widest text-workspace-accent">
            {object.type === 'document' ? 'Document' : 'Dataset'}
          </span>
          <h2 className="text-sm font-semibold text-workspace-text">{object.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClose}
            className="rounded-md p-2 text-workspace-text-secondary transition-colors hover:bg-workspace-surface hover:text-workspace-text"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Immersive content */}
      <div className="flex-1 overflow-y-auto">
        {object.type === 'document' ? (
          <DocumentReader object={object} isImmersive />
        ) : object.type === 'dataset' ? (
          <DatasetView object={object} isImmersive />
        ) : null}
      </div>
    </div>
  );
}
