import { useCallback } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { parseIntentAI } from '@/lib/intent-engine';
import { WorkspaceObject, IntentOrigin, WorkspaceAction } from '@/lib/workspace-types';
import { computeFreeformPosition } from '@/lib/freeform-placement';
import { handleUpdate, handleFuse, handleRefineRules, HandlerResult, DispatchInstruction } from '@/lib/action-handlers';
import { toast } from '@/hooks/use-toast';
import { buildDocumentObjectContext, resolveDocumentRecord } from '@/lib/document-store';
import { validateSections } from '@/lib/card-schema';
import { executeDataQuery } from '@/lib/data-query';
import { addQuery, updateLastResponse } from '@/lib/conversation-memory';
import { retrieveRelevantMemories, formatMemoriesForPrompt, determineWorkspaceState } from '@/lib/memory-retriever';
import { recordAction, detectLearningSignals } from '@/lib/memory-detector';
import { supabase } from '@/integrations/supabase/client';

// Store document IDs ref for context injection
let _documentIdsRef: string[] = [];

let objectCounter = 0;

interface ApplyOutcome {
  response: string | null;
  summary: string;
  affectedObjectIds: string[];
  createdObjectIds: string[];
  focusedObjectId: string | null;
}

interface ExecutionOutcome {
  response: string | null;
  affectedObjectIds: string[];
  createdObjectIds: string[];
  focusedObjectId: string | null;
  summaryParts: string[];
}

function createIntentId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `intent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function mergeUnique(base: string[], incoming: string[]): string[] {
  return [...new Set([...base, ...incoming])];
}

export function useWorkspaceActions() {
  const { state, dispatch } = useWorkspace();

  const setDocumentIds = useCallback((ids: string[]) => {
    _documentIdsRef = ids;
  }, []);

  const processIntent = useCallback(
    async (query: string) => {
      dispatch({ type: 'SET_SHERPA_PROCESSING', payload: true });

      const origin: IntentOrigin = {
        type: 'user-query',
        intentId: createIntentId(),
        query,
        timestamp: Date.now(),
      };
      dispatch({ type: 'ADD_RECENT_INTENT', payload: origin });

      // Record query in conversation memory
      addQuery(query);

      // Retrieve relevant Sherpa memories for prompt injection (non-blocking)
      let memoryBlock = '';
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const objectTypes = Object.values(state.objects)
            .filter(o => o.status !== 'dissolved')
            .map(o => o.type);
          const memories = await retrieveRelevantMemories(user.id, {
            query,
            objectTypes,
            workspaceState: determineWorkspaceState(state),
          });
          memoryBlock = formatMemoriesForPrompt(memories);
        }
      } catch (e) {
        console.warn('[processIntent] Memory retrieval failed, continuing without:', e);
      }

      try {
        const result = await parseIntentAI(query, state.objects, _documentIdsRef, state.activeContext, memoryBlock);
        const outcome = await applyResult(result, origin);

        if (outcome.response) {
          updateLastResponse(outcome.response);
        }

        dispatch({
          type: 'UPDATE_RECENT_INTENT_OUTCOME',
          payload: {
            intentId: origin.intentId!,
            patch: {
              response: outcome.response || undefined,
              outcomeSummary: outcome.summary || undefined,
              resultingFocusObjectId: outcome.focusedObjectId,
              affectedObjectIds: outcome.affectedObjectIds,
              createdObjectIds: outcome.createdObjectIds,
            },
          },
        });
      } catch (aiError) {
        console.error('[processIntent] AI intent parsing failed:', aiError);
        const errorMsg = 'Sherpa is having trouble reaching the AI service right now. Please check your connection and try again in a moment.';
        updateLastResponse(errorMsg);
        dispatch({ type: 'SET_SHERPA_RESPONSE', payload: errorMsg });
        dispatch({
          type: 'UPDATE_RECENT_INTENT_OUTCOME',
          payload: {
            intentId: origin.intentId!,
            patch: {
              response: errorMsg,
              outcomeSummary: 'Intent execution failed before any workspace action was applied.',
              resultingFocusObjectId: state.activeContext.focusedObjectId,
              affectedObjectIds: [],
              createdObjectIds: [],
            },
          },
        });
      }

      dispatch({ type: 'SET_SHERPA_PROCESSING', payload: false });
    },
    [state.objects, state.activeContext, dispatch, applyResult]
  );

  // ─── Pipeline: parse → resolve → materialize → observe ─────────────────

  async function applyResult(result: { actions: WorkspaceAction[] }, origin: IntentOrigin): Promise<ApplyOutcome> {
    const outcome: ApplyOutcome = {
      response: null,
      summary: '',
      affectedObjectIds: [],
      createdObjectIds: [],
      focusedObjectId: state.activeContext.focusedObjectId,
    };
    const summaryParts: string[] = [];

    for (const action of result.actions) {
      switch (action.type) {
        case 'respond':
          dispatch({ type: 'SET_SHERPA_RESPONSE', payload: action.message });
          outcome.response = action.message;
          break;

        case 'create': {
          const created = await handleCreate(action, origin);
          outcome.createdObjectIds.push(created.id);
          outcome.affectedObjectIds.push(created.id);
          outcome.focusedObjectId = created.id;
          summaryParts.push(`Created ${created.type} "${created.title}".`);
          break;
        }

        case 'focus':
          dispatch({ type: 'FOCUS_OBJECT', payload: { id: action.objectId } });
          dispatch({ type: 'TOUCH_OBJECT', payload: { id: action.objectId } });
          outcome.affectedObjectIds = mergeUnique(outcome.affectedObjectIds, [action.objectId]);
          outcome.focusedObjectId = action.objectId;
          summaryParts.push(`Focused ${state.objects[action.objectId]?.title || action.objectId}.`);
          break;

        case 'dissolve':
          dispatch({ type: 'DISSOLVE_OBJECT', payload: { id: action.objectId } });
          outcome.affectedObjectIds = mergeUnique(outcome.affectedObjectIds, [action.objectId]);
          summaryParts.push(`Dissolved ${state.objects[action.objectId]?.title || action.objectId}.`);
          break;

        case 'update': {
          const target = state.objects[action.objectId];
          if (!target) {
            dispatch({ type: 'SET_SHERPA_RESPONSE', payload: 'Could not find the specified object to update.' });
            outcome.response = 'Could not find the specified object to update.';
            break;
          }
          try {
            const handlerResult = await handleUpdate({
              target,
              instruction: action.instruction,
              documentIds: _documentIdsRef,
              dataQuery: (action as any).dataQuery,
              sections: (action as any).sections,
              sectionOperations: (action as any).sectionOperations,
            });
            const execution = executeResult(handlerResult);
            outcome.response = execution.response || outcome.response;
            outcome.affectedObjectIds = mergeUnique(outcome.affectedObjectIds, execution.affectedObjectIds);
            outcome.createdObjectIds = mergeUnique(outcome.createdObjectIds, execution.createdObjectIds);
            outcome.focusedObjectId = execution.focusedObjectId ?? outcome.focusedObjectId;
            summaryParts.push(...execution.summaryParts);
          } catch (e) {
            console.error('[applyResult] Update handler failed:', e);
            dispatch({ type: 'SET_SHERPA_RESPONSE', payload: `Could not update "${target.title}". Try a different instruction.` });
            outcome.response = `Could not update "${target.title}". Try a different instruction.`;
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
            const execution = executeResult(handlerResult);
            outcome.response = execution.response || outcome.response;
            outcome.affectedObjectIds = mergeUnique(outcome.affectedObjectIds, execution.affectedObjectIds);
            outcome.createdObjectIds = mergeUnique(outcome.createdObjectIds, execution.createdObjectIds);
            outcome.focusedObjectId = execution.focusedObjectId ?? outcome.focusedObjectId;
            summaryParts.push(...execution.summaryParts);
            // Open fused object after materialization animation
            const materialize = handlerResult.dispatches.find((dispatchInstruction: DispatchInstruction) => dispatchInstruction.type === 'MATERIALIZE_OBJECT');
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
            const execution = executeResult(handlerResult);
            outcome.response = execution.response || outcome.response;
            outcome.affectedObjectIds = mergeUnique(outcome.affectedObjectIds, execution.affectedObjectIds);
            outcome.createdObjectIds = mergeUnique(outcome.createdObjectIds, execution.createdObjectIds);
            outcome.focusedObjectId = execution.focusedObjectId ?? outcome.focusedObjectId;
            summaryParts.push(...execution.summaryParts);
          } catch (e) {
            console.error('[applyResult] Refine rules handler failed:', e);
            dispatch({ type: 'SET_SHERPA_RESPONSE', payload: 'Could not update rules. Try being more specific about what to change.' });
            outcome.response = 'Could not update rules. Try being more specific about what to change.';
          }
          break;
        }
      }
    }

    outcome.summary = summaryParts.join(' ');

    // Detect implicit learning signals (non-blocking)
    for (const action of result.actions) {
      recordAction({ action, query: origin.query || '', timestamp: Date.now() });
    }
    if (result.actions.length > 0) {
      const lastAction = result.actions[result.actions.length - 1];
      detectLearningSignals(origin.query || '', lastAction, state.objects).catch(() => {});
    }

    return outcome;
  }

  /** Execute dispatch instructions + toasts from a handler result */
  function executeResult(handlerResult: HandlerResult): ExecutionOutcome {
    const execution: ExecutionOutcome = {
      response: null,
      affectedObjectIds: [],
      createdObjectIds: [],
      focusedObjectId: null,
      summaryParts: [],
    };

    for (const d of handlerResult.dispatches) {
      dispatch(d as WorkspaceReducerAction);

      switch (d.type) {
        case 'SET_SHERPA_RESPONSE':
          execution.response = d.payload;
          break;
        case 'FOCUS_OBJECT':
          execution.focusedObjectId = d.payload.id;
          execution.affectedObjectIds = mergeUnique(execution.affectedObjectIds, [d.payload.id]);
          break;
        case 'UPDATE_OBJECT_CONTEXT':
          execution.affectedObjectIds = mergeUnique(execution.affectedObjectIds, [d.payload.id]);
          execution.summaryParts.push(`Updated ${state.objects[d.payload.id]?.title || d.payload.id}.`);
          break;
        case 'UPDATE_OBJECT':
          execution.affectedObjectIds = mergeUnique(execution.affectedObjectIds, [d.payload.id]);
          execution.summaryParts.push(`Updated ${d.payload.title || state.objects[d.payload.id]?.title || d.payload.id}.`);
          break;
        case 'MATERIALIZE_OBJECT':
          execution.createdObjectIds = mergeUnique(execution.createdObjectIds, [d.payload.id]);
          execution.affectedObjectIds = mergeUnique(execution.affectedObjectIds, [d.payload.id]);
          execution.focusedObjectId = d.payload.id;
          execution.summaryParts.push(`Created ${d.payload.type} "${d.payload.title}".`);
          break;
      }
    }
    if (handlerResult.toasts) {
      for (const t of handlerResult.toasts) {
        toast(t);
      }
    }
    return execution;
  }

  /** Resolve data and materialize a new workspace object */
  async function handleCreate(action: Extract<WorkspaceAction, { type: 'create' }>, origin: IntentOrigin) {
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

    // Build context — merge AI-generated sections + dataQuery results
    let context: Record<string, unknown> = resolvedDocument
      ? buildDocumentObjectContext(resolvedDocument)
      : (action.data || {});

    // If AI provided sections (analysis or enhanced standard card)
    if ((action as any).sections) {
      const validSections = validateSections((action as any).sections);
      if (validSections.length > 0) {
        context = { ...context, sections: validSections };
      }
    }

    // If AI provided a dataQuery, execute and merge results
    if ((action as any).dataQuery) {
      const queryResult = executeDataQuery((action as any).dataQuery);
      context = {
        ...context,
        columns: queryResult.columns,
        rows: queryResult.rows,
        dataQuery: (action as any).dataQuery,
        queryMeta: { totalMatched: queryResult.totalMatched, truncated: queryResult.truncated },
      };
    }

    const obj: Omit<WorkspaceObject, 'status' | 'createdAt' | 'lastInteractedAt'> = {
      id,
      type: action.objectType,
      title: resolvedDocument?.filename || action.title,
      pinned: false,
      origin,
      relationships,
      context,
      position: { zone: 'primary', order: 0 },
      freeformPosition,
    };
    dispatch({ type: 'MATERIALIZE_OBJECT', payload: obj });
    setTimeout(() => dispatch({ type: 'OPEN_OBJECT', payload: { id } }), 400);
    return { id, title: obj.title, type: obj.type };
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
