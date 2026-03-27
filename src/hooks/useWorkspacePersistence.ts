import { useEffect, useRef } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WorkspaceState } from '@/lib/workspace-types';

const STORAGE_KEY = 'dream-state-workspace';

export function useWorkspacePersistence() {
  const { state, dispatch } = useWorkspace();
  const initialized = useRef(false);

  // Restore on mount
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;

      const parsed: Partial<WorkspaceState> = JSON.parse(stored);
      if (!parsed.objects) return;

      // Restore objects
      for (const obj of Object.values(parsed.objects)) {
        if (obj.status === 'dissolved') continue;
        dispatch({
          type: 'MATERIALIZE_OBJECT',
          payload: {
            id: obj.id,
            type: obj.type,
            title: obj.title,
            pinned: obj.pinned,
            origin: obj.origin,
            relationships: obj.relationships,
            context: obj.context,
            position: obj.position,
            freeformPosition: obj.freeformPosition,
          },
        });
        if (obj.status === 'open') {
          setTimeout(() => dispatch({ type: 'OPEN_OBJECT', payload: { id: obj.id } }), 100);
        }
        if (obj.status === 'collapsed') {
          setTimeout(() => dispatch({ type: 'COLLAPSE_OBJECT', payload: { id: obj.id } }), 100);
        }
      }

      // Restore layout mode
      if (parsed.layoutMode) {
        dispatch({ type: 'SET_LAYOUT_MODE', payload: parsed.layoutMode });
      }
    } catch { /* corrupt storage — ignore */ }
  }, [dispatch]);

  // Save on change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const serializable: Partial<WorkspaceState> = {
          objects: state.objects,
          layoutMode: state.layoutMode,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
      } catch { /* storage full — ignore */ }
    }, 1000);

    return () => clearTimeout(timer);
  }, [state.objects, state.layoutMode]);
}
