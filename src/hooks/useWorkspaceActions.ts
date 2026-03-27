import { useCallback } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { parseIntent } from '@/lib/intent-engine';
import { generateSuggestions } from '@/lib/sherpa-engine';
import { WorkspaceObject, IntentOrigin } from '@/lib/workspace-types';

let objectCounter = 0;

export function useWorkspaceActions() {
  const { state, dispatch } = useWorkspace();

  const processIntent = useCallback(
    (query: string) => {
      dispatch({ type: 'SET_SHERPA_PROCESSING', payload: true });

      const origin: IntentOrigin = { type: 'user-query', query };
      dispatch({ type: 'ADD_RECENT_INTENT', payload: origin });

      // Simulate brief processing delay for materialization feel
      setTimeout(() => {
        const result = parseIntent(query, state.objects);

        for (const action of result.actions) {
          switch (action.type) {
            case 'respond':
              dispatch({ type: 'SET_SHERPA_RESPONSE', payload: action.message });
              break;

            case 'create': {
              objectCounter++;
              const id = `wo-${Date.now()}-${objectCounter}`;
              const obj: Omit<WorkspaceObject, 'status' | 'createdAt' | 'lastInteractedAt'> = {
                id,
                type: action.objectType,
                title: action.title,
                pinned: false,
                origin,
                relationships: action.relatedTo ?? [],
                context: action.data,
                position: { zone: 'primary', order: 0 },
              };
              dispatch({ type: 'MATERIALIZE_OBJECT', payload: obj });

              // Transition to open after materialization animation
              setTimeout(() => {
                dispatch({ type: 'OPEN_OBJECT', payload: { id } });
              }, 400);
              break;
            }

            case 'focus':
              dispatch({ type: 'FOCUS_OBJECT', payload: { id: action.objectId } });
              dispatch({ type: 'TOUCH_OBJECT', payload: { id: action.objectId } });
              break;

            case 'dissolve':
              dispatch({ type: 'DISSOLVE_OBJECT', payload: { id: action.objectId } });
              break;
          }
        }

        // Update suggestions based on new state
        setTimeout(() => {
          const suggestions = generateSuggestions(state.objects);
          dispatch({ type: 'SET_SHERPA_SUGGESTIONS', payload: suggestions });
        }, 100);

        dispatch({ type: 'SET_SHERPA_PROCESSING', payload: false });
      }, 300);
    },
    [state.objects, dispatch]
  );

  const collapseObject = useCallback(
    (id: string) => {
      dispatch({ type: 'COLLAPSE_OBJECT', payload: { id } });
    },
    [dispatch]
  );

  const restoreObject = useCallback(
    (id: string) => {
      dispatch({ type: 'RESTORE_OBJECT', payload: { id } });
      setTimeout(() => {
        dispatch({ type: 'OPEN_OBJECT', payload: { id } });
      }, 400);
    },
    [dispatch]
  );

  const dissolveObject = useCallback(
    (id: string) => {
      dispatch({ type: 'DISSOLVE_OBJECT', payload: { id } });
    },
    [dispatch]
  );

  const pinObject = useCallback(
    (id: string) => {
      dispatch({ type: 'PIN_OBJECT', payload: { id } });
    },
    [dispatch]
  );

  const unpinObject = useCallback(
    (id: string) => {
      dispatch({ type: 'UNPIN_OBJECT', payload: { id } });
    },
    [dispatch]
  );

  const focusObject = useCallback(
    (id: string | null) => {
      dispatch({ type: 'FOCUS_OBJECT', payload: { id } });
      if (id) dispatch({ type: 'TOUCH_OBJECT', payload: { id } });
    },
    [dispatch]
  );

  return {
    processIntent,
    collapseObject,
    restoreObject,
    dissolveObject,
    pinObject,
    unpinObject,
    focusObject,
  };
}
