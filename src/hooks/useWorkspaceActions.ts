import { useCallback } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { parseIntentAI } from '@/lib/intent-engine';
import { generateSuggestions } from '@/lib/sherpa-engine';
import { WorkspaceObject, IntentOrigin } from '@/lib/workspace-types';
import { computeFreeformPosition } from '@/lib/freeform-placement';
import { handleUpdate, handleFuse, handleRefineRules } from '@/lib/action-handlers';
import { toast } from '@/hooks/use-toast';
import { buildDocumentObjectContext, resolveDocumentRecord } from '@/lib/document-store';
import { addQuery, updateLastResponse } from '@/lib/conversation-memory';

// Store document IDs ref for context injection
let _documentIdsRef: string[] = [];

let objectCounter = 0;

export function useWorkspaceActions() {
  const { state, dispatch } = useWorkspace();

  const setDocumentIds = useCallback((ids: string[]) => {
    _documentIdsRef = ids;
  }, []);

  const processIntent = useCallback(
    async (query: string) => {
      dispatch({ type: 'SET_SHERPA_PROCESSING', payload: true });

      const origin: IntentOrigin = { type: 'user-query', query };
      dispatch({ type: 'ADD_RECENT_INTENT', payload: origin });

      // Record query in conversation memory
      addQuery(query);

      try {
        const result = await parseIntentAI(query, state.objects, _documentIdsRef);
        // Record the AI's response for conversation continuity
        const responseAction = result.actions.find(a => a.type === 'respond');
        if (responseAction && 'message' in responseAction) {
          updateLastResponse(responseAction.message as string);
        }
        await applyResult(result, origin);
      } catch (aiError) {
        console.error('[processIntent] AI intent parsing failed:', aiError);
        const errorMsg = 'Sherpa is having trouble reaching the AI service right now. Please check your connection and try again in a moment.';
        updateLastResponse(errorMsg);
        dispatch({ type: 'SET_SHERPA_RESPONSE', payload: errorMsg });
      }

      dispatch({ type: 'SET_SHERPA_PROCESSING', payload: false });
    },
    [state.objects, state.layoutMode, dispatch]
  );

  // ─── Pipeline: parse → resolve → materialize → observe ─────────────────

  async function applyResult(result: { actions: any[] }, origin: IntentOrigin) {
    for (const action of result.actions) {
      switch (action.type) {
        case 'respond':
          dispatch({ type: 'SET_SHERPA_RESPONSE', payload: action.message });
          break;

        case 'create':
          await handleCreate(action, origin);
          break;

        case 'focus':
          dispatch({ type: 'FOCUS_OBJECT', payload: { id: action.objectId } });
          dispatch({ type: 'TOUCH_OBJECT', payload: { id: action.objectId } });
          break;

        case 'dissolve':
          dispatch({ type: 'DISSOLVE_OBJECT', payload: { id: action.objectId } });
          break;

        case 'update': {
          const target = state.objects[action.objectId];
          if (!target) {
            dispatch({ type: 'SET_SHERPA_RESPONSE', payload: 'Could not find the specified object to update.' });
            break;
          }
          try {
            const handlerResult = await handleUpdate({
              target,
              instruction: action.instruction,
              documentIds: _documentIdsRef,
            });
            executeResult(handlerResult);
          } catch (e) {
            console.error('[applyResult] Update handler failed:', e);
            dispatch({ type: 'SET_SHERPA_RESPONSE', payload: `Could not update "${target.title}". Try a different instruction.` });
          }
          break;
        }

        case 'fuse': {
          const objA = state.objects[action.objectIdA];
          const objB = state.objects[action.objectIdB];
          if (!objA || !objB) {
            dispatch({ type: 'SET_SHERPA_RESPONSE', payload: 'Could not find the specified objects to fuse.' });
            break;
          }
          try {
            const handlerResult = await handleFuse({
              objA,
              objB,
              layoutMode: state.layoutMode,
            });
            executeResult(handlerResult);
            // Open fused object after materialization animation
            const materialize = handlerResult.dispatches.find(d => d.type === 'MATERIALIZE_OBJECT');
            if (materialize?.payload?.id) {
              setTimeout(() => dispatch({ type: 'OPEN_OBJECT', payload: { id: materialize.payload.id } }), 400);
            }
          } catch (e) {
            console.error('[applyResult] Fuse handler failed:', e);
            dispatch({ type: 'SET_SHERPA_RESPONSE', payload: 'Fusion failed — try again or ask the Sherpa directly.' });
          }
          break;
        }

        case 'refine-rules': {
          try {
            const handlerResult = await handleRefineRules({
              feedback: action.feedback,
              objects: state.objects,
            });
            executeResult(handlerResult);
          } catch (e) {
            console.error('[applyResult] Refine rules handler failed:', e);
            dispatch({ type: 'SET_SHERPA_RESPONSE', payload: 'Could not update rules. Try being more specific about what to change.' });
          }
          break;
        }
      }
    }

    // Observe — update suggestions after all actions
    setTimeout(() => {
      const suggestions = generateSuggestions(state.objects);
      dispatch({ type: 'SET_SHERPA_SUGGESTIONS', payload: suggestions });
    }, 100);
  }

  /** Execute dispatch instructions + toasts from a handler result */
  function executeResult(handlerResult: { dispatches: any[]; toasts?: { title: string; description?: string }[] }) {
    for (const d of handlerResult.dispatches) {
      dispatch(d);
    }
    if (handlerResult.toasts) {
      for (const t of handlerResult.toasts) {
        toast(t);
      }
    }
  }

  /** Resolve data and materialize a new workspace object */
  async function handleCreate(action: any, origin: IntentOrigin) {
    objectCounter++;
    const id = `wo-${Date.now()}-${objectCounter}`;
    const relationships = action.relatedTo ?? [];
    const freeformPosition =
      state.layoutMode === 'freeform'
        ? computeFreeformPosition(state.objects, { relationships }, window.innerWidth, window.innerHeight)
        : undefined;

    const resolvedDocument = action.objectType === 'document'
      ? await resolveDocumentRecord({
          title: action.title,
          query: origin.query,
          preferredIds: _documentIdsRef,
        })
      : null;

    const obj: Omit<WorkspaceObject, 'status' | 'createdAt' | 'lastInteractedAt'> = {
      id,
      type: action.objectType,
      title: resolvedDocument?.filename || action.title,
      pinned: false,
      origin,
      relationships,
      context: resolvedDocument ? buildDocumentObjectContext(resolvedDocument) : action.data,
      position: { zone: 'primary', order: 0 },
      freeformPosition,
    };
    dispatch({ type: 'MATERIALIZE_OBJECT', payload: obj });
    setTimeout(() => dispatch({ type: 'OPEN_OBJECT', payload: { id } }), 400);
  }

  const collapseObject = useCallback(
    (id: string) => { dispatch({ type: 'COLLAPSE_OBJECT', payload: { id } }); },
    [dispatch]
  );

  const restoreObject = useCallback(
    (id: string) => {
      dispatch({ type: 'RESTORE_OBJECT', payload: { id } });
      setTimeout(() => { dispatch({ type: 'OPEN_OBJECT', payload: { id } }); }, 400);
    },
    [dispatch]
  );

  const dissolveObject = useCallback(
    (id: string) => { dispatch({ type: 'DISSOLVE_OBJECT', payload: { id } }); },
    [dispatch]
  );

  const pinObject = useCallback(
    (id: string) => { dispatch({ type: 'PIN_OBJECT', payload: { id } }); },
    [dispatch]
  );

  const unpinObject = useCallback(
    (id: string) => { dispatch({ type: 'UNPIN_OBJECT', payload: { id } }); },
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
    setDocumentIds,
    collapseObject,
    restoreObject,
    dissolveObject,
    pinObject,
    unpinObject,
    focusObject,
  };
}
