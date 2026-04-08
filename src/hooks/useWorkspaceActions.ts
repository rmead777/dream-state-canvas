import { useCallback, useRef } from 'react';
import { computeLayoutWithOverflow } from '@/lib/spatial-orchestrator';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { agentLoop, orchestratorLoop } from '@/lib/sherpa-agent';
import { WorkspaceObject, IntentOrigin, WorkspaceAction, WorkspaceReducerAction } from '@/lib/workspace-types';
import { computeFreeformPosition } from '@/lib/freeform-placement';
import { handleUpdate, handleFuse, handleRefineRules, HandlerResult, DispatchInstruction } from '@/lib/action-handlers';
import { toast } from '@/hooks/use-toast';
import { buildDocumentObjectContext, resolveDocumentRecord, getDocument, extractDataset } from '@/lib/document-store';
import { validateSections } from '@/lib/card-schema';
import { executeDataQuery } from '@/lib/data-query';
import { getDataset } from '@/lib/active-dataset';
import { addQuery, updateLastResponse, updateLastOutcomeCards } from '@/lib/conversation-memory';
import { extractEntityRefs } from '@/lib/entity-extractor';
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

  // Always-current state ref — prevents stale closures in async callbacks.
  // applyResult and handleCreate run asynchronously and need the latest state,
  // not the state captured when processIntent's useCallback was created.
  const stateRef = useRef(state);
  stateRef.current = state;

  const setDocumentIds = useCallback((ids: string[]) => {
    _documentIdsRef = ids;
  }, []);

  const processIntent = useCallback(
    async (query: string, images?: string[]) => {
      dispatch({ type: 'SET_SHERPA_PROCESSING', payload: true });

      const origin: IntentOrigin = {
        type: 'user-query',
        intentId: createIntentId(),
        query,
        timestamp: Date.now(),
      };
      dispatch({ type: 'ADD_RECENT_INTENT', payload: origin });

      // Retrieve relevant Sherpa memories for prompt injection (non-blocking)
      // NOTE: addQuery is called AFTER agentLoop so history only contains completed turns.
      // If we addQuery here, getConversationMessages() inside agentLoop returns the current
      // query in history AND agentLoop appends it again as the structured context message.
      let memoryBlock = '';
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const objectTypes = Object.values(stateRef.current.objects)
            .filter(o => o.status !== 'dissolved')
            .map(o => o.type);
          const memories = await retrieveRelevantMemories(user.id, {
            query,
            objectTypes,
            workspaceState: determineWorkspaceState(stateRef.current),
          });
          memoryBlock = formatMemoriesForPrompt(memories);
        }
      } catch (e) {
        console.warn('[processIntent] Memory retrieval failed, continuing without:', e);
      }

      try {
        const agentResult = await orchestratorLoop({
          query,
          workspaceState: stateRef.current,
          activeContext: stateRef.current.activeContext,
          documentIds: _documentIdsRef,
          memories: memoryBlock,
          images,
          onStatusUpdate: (status) => {
            if (status) {
              dispatch({ type: 'SET_SHERPA_STATUS', payload: status });
            }
          },
        });

        // Convert agent result to the format applyResult expects
        const result = {
          actions: [
            ...(agentResult.response ? [{ type: 'respond' as const, message: agentResult.response }] : []),
            ...agentResult.actions,
          ],
        };
        const outcome = await applyResult(result, origin);

        // Surface AI-generated next moves as suggestion chips.
        // Uses SET_SHERPA_SUGGESTIONS_AI (not SET_SHERPA_SUGGESTIONS) so SherpaContext
        // won't immediately overwrite them with engine-generated defaults.
        if (agentResult.nextMoves && agentResult.nextMoves.length > 0) {
          dispatch({
            type: 'SET_SHERPA_SUGGESTIONS_AI',
            payload: agentResult.nextMoves.map((m, i) => ({
              id: `ai-nm-${Date.now()}-${i}`,
              label: m.label,
              query: m.query,
              priority: i + 1,
            })),
          });
        }

        // Progressive text reveal — simulated streaming for the response
        if (outcome.response) {
          // Stop the "Reasoning..." indicator before text starts appearing
          dispatch({ type: 'SET_SHERPA_PROCESSING', payload: false });

          const text = outcome.response;
          if (text.length > 40) {
            // Reveal word-by-word, targeting ~1.2s total
            const words = text.split(/(\s+)/);
            const delayMs = Math.max(8, Math.min(25, 1200 / words.length));
            let revealed = '';
            for (const word of words) {
              revealed += word;
              dispatch({ type: 'SET_SHERPA_RESPONSE', payload: revealed });
              await new Promise(r => setTimeout(r, delayMs));
            }
          }
          // Set final full text (covers both short and long responses)
          dispatch({ type: 'SET_SHERPA_RESPONSE', payload: text });
          addQuery(query);
          updateLastResponse(text);
          // Link created/updated cards to this conversation turn for context-chain threading
          if (outcome.createdObjectIds.length > 0 || outcome.affectedObjectIds.length > 0) {
            updateLastOutcomeCards([...new Set([...outcome.createdObjectIds, ...outcome.affectedObjectIds])]);
          }
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

        // Return steps so the caller (SherpaRail) can show reasoning history
        return { steps: agentResult.steps || [] };
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
              resultingFocusObjectId: stateRef.current.activeContext.focusedObjectId,
              affectedObjectIds: [],
              createdObjectIds: [],
            },
          },
        });
      }

      dispatch({ type: 'SET_SHERPA_PROCESSING', payload: false });
    },
    [dispatch]
  );

  // ─── Pipeline: parse → resolve → materialize → observe ─────────────────

  async function applyResult(result: { actions: WorkspaceAction[] }, origin: IntentOrigin): Promise<ApplyOutcome> {
    const outcome: ApplyOutcome = {
      response: null,
      summary: '',
      affectedObjectIds: [],
      createdObjectIds: [],
      focusedObjectId: stateRef.current.activeContext.focusedObjectId,
    };
    const summaryParts: string[] = [];

    for (const action of result.actions) {
      switch (action.type) {
        case 'respond':
          // Don't dispatch here — processIntent handles progressive text reveal
          outcome.response = action.message;
          break;

        case 'create': {
          const created = await handleCreate(action, origin);
          outcome.createdObjectIds.push(created.id);
          outcome.affectedObjectIds.push(created.id);
          outcome.focusedObjectId = created.id;
          summaryParts.push(`Created ${created.type} "${created.title}".`);
          // Ensure new card wins the layout sort even if other cards were touched during creation
          dispatch({ type: 'TOUCH_OBJECT', payload: { id: created.id } });
          dispatch({ type: 'REFLOW_LAYOUT', payload: computeLayoutWithOverflow(stateRef.current.objects).layout });
          break;
        }

        case 'immersive':
          dispatch({ type: 'ENTER_IMMERSIVE', payload: { id: action.objectId } });
          dispatch({ type: 'TOUCH_OBJECT', payload: { id: action.objectId } });
          outcome.affectedObjectIds = mergeUnique(outcome.affectedObjectIds, [action.objectId]);
          summaryParts.push(`Opened ${stateRef.current.objects[action.objectId]?.title || action.objectId} in immersive view.`);
          break;

        case 'open-source-document': {
          // Find existing source card on canvas by sourceDocId or documentId match
          // Exclude dataset-edit-preview cards — those share sourceDocId but aren't the source viewer
          const existing = Object.values(stateRef.current.objects).find(
            o => o.status !== 'dissolved' &&
              o.type !== 'dataset-edit-preview' &&
              !o.context?.isDatasetEdit &&
              (o.context?.sourceDocId === action.documentId || o.id === action.documentId)
          );
          if (existing) {
            dispatch({ type: 'ENTER_IMMERSIVE', payload: { id: existing.id } });
            dispatch({ type: 'TOUCH_OBJECT', payload: { id: existing.id } });
            summaryParts.push(`Opened "${existing.title}" in immersive view.`);
          } else {
            // No card on canvas yet — fetch from Supabase and materialize it
            try {
              const doc = await getDocument(action.documentId);
              if (!doc) { summaryParts.push('Source document not found.'); break; }

              const isSpreadsheet = doc.file_type === 'xlsx' || doc.file_type === 'csv';
              const id = `wo-${isSpreadsheet ? 'dataset' : 'document'}-${Date.now()}`;
              const title = doc.filename.replace(/\.[^/.]+$/, '');

              let context: Record<string, any>;
              if (isSpreadsheet) {
                const ds = extractDataset(doc);
                context = {
                  columns: ds?.columns || [],
                  rows: ds?.rows || [],
                  sourceDocId: doc.id,
                  fileName: doc.filename,
                  fileType: doc.file_type,
                };
              } else {
                context = buildDocumentObjectContext(doc);
              }

              dispatch({
                type: 'MATERIALIZE_OBJECT',
                payload: {
                  id,
                  type: isSpreadsheet ? 'dataset' : 'document',
                  title,
                  pinned: false,
                  origin,
                  relationships: [],
                  context,
                  position: { zone: 'primary', order: 0 },
                },
              });
              // Short delay to let the reducer process the new object before entering immersive
              await new Promise(r => setTimeout(r, 80));
              dispatch({ type: 'OPEN_OBJECT', payload: { id } });
              dispatch({ type: 'ENTER_IMMERSIVE', payload: { id } });
              outcome.createdObjectIds.push(id);
              summaryParts.push(`Opened "${title}" in immersive view.`);
            } catch (e) {
              console.error('[applyResult] openSourceDocument failed:', e);
              summaryParts.push('Could not open source document.');
            }
          }
          break;
        }

        case 'focus':
          dispatch({ type: 'FOCUS_OBJECT', payload: { id: action.objectId } });
          dispatch({ type: 'TOUCH_OBJECT', payload: { id: action.objectId } });
          outcome.affectedObjectIds = mergeUnique(outcome.affectedObjectIds, [action.objectId]);
          outcome.focusedObjectId = action.objectId;
          summaryParts.push(`Focused ${stateRef.current.objects[action.objectId]?.title || action.objectId}.`);
          break;

        case 'dissolve':
          dispatch({ type: 'DISSOLVE_OBJECT', payload: { id: action.objectId } });
          outcome.affectedObjectIds = mergeUnique(outcome.affectedObjectIds, [action.objectId]);
          summaryParts.push(`Dissolved ${stateRef.current.objects[action.objectId]?.title || action.objectId}.`);
          break;

        case 'update': {
          const target = stateRef.current.objects[action.objectId];
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
            // Float updated card to top — touch updates lastInteractedAt, reflow resorts layout
            dispatch({ type: 'TOUCH_OBJECT', payload: { id: action.objectId } });
            dispatch({ type: 'REFLOW_LAYOUT', payload: computeLayoutWithOverflow(stateRef.current.objects).layout });
          } catch (e) {
            console.error('[applyResult] Update handler failed:', e);
            dispatch({ type: 'SET_SHERPA_RESPONSE', payload: `Could not update "${target.title}". Try a different instruction.` });
            outcome.response = `Could not update "${target.title}". Try a different instruction.`;
          }
          break;
        }

        case 'fuse': {
          const objA = stateRef.current.objects[action.objectIdA];
          const objB = stateRef.current.objects[action.objectIdB];
          if (!objA || !objB) {
            dispatch({ type: 'SET_SHERPA_RESPONSE', payload: 'Could not find the specified objects to fuse.' });
            break;
          }
          try {
            const handlerResult = await handleFuse({
              objA,
              objB,
              layoutMode: stateRef.current.layoutMode,
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
              objects: stateRef.current.objects,
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
      detectLearningSignals(origin.query || '', lastAction, stateRef.current.objects).catch(() => {});
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
          execution.summaryParts.push(`Updated ${stateRef.current.objects[d.payload.id]?.title || d.payload.id}.`);
          break;
        case 'UPDATE_OBJECT':
          execution.affectedObjectIds = mergeUnique(execution.affectedObjectIds, [d.payload.id]);
          execution.summaryParts.push(`Updated ${d.payload.title || stateRef.current.objects[d.payload.id]?.title || d.payload.id}.`);
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
    // Use pre-assigned ID from agent loop shadow state if available, otherwise generate
    const id = (action as any).id || `wo-${Date.now()}-${objectCounter}`;
    const relationships = action.relatedTo ?? [];
    const freeformPosition =
      stateRef.current.layoutMode === 'freeform'
        ? computeFreeformPosition(stateRef.current.objects, { relationships }, window.innerWidth, window.innerHeight)
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
      ? buildDocumentObjectContext(resolvedDocument) as unknown as Record<string, unknown>
      : (action.data || {});

    // If AI provided sections (analysis or enhanced standard card)
    if ((action as any).sections) {
      const validSections = validateSections((action as any).sections);
      if (validSections.length > 0) {
        context = { ...context, sections: validSections };
      }
    }

    // If AI provided a dataQuery, execute and merge results.
    // BUT: skip if action.data already has columns/rows (e.g. scratchpads) —
    // executing the dataQuery would overwrite the already-correct data.
    const alreadyHasData = Array.isArray((context as any).columns) && (context as any).columns.length > 0
      && Array.isArray((context as any).rows);
    if ((action as any).dataQuery && !alreadyHasData) {
      const dq = (action as any).dataQuery;
      const ds = dq.documentId ? await getDataset(dq.documentId) : undefined;
      const queryResult = executeDataQuery(ds ? { ...dq, _dataset: ds } : dq);
      context = {
        ...context,
        columns: queryResult.columns,
        rows: queryResult.rows,
        dataQuery: dq,
        queryMeta: { totalMatched: queryResult.totalMatched, truncated: queryResult.truncated },
      };
    } else if ((action as any).dataQuery) {
      // Preserve the dataQuery reference without re-executing
      context = { ...context, dataQuery: (action as any).dataQuery };
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

    // Extract entity refs from sections for smart card linking
    const sections = (context as any).sections;
    if (Array.isArray(sections) && sections.length > 0) {
      const entityRefs = await extractEntityRefs(sections);
      if (entityRefs.length > 0) {
        dispatch({ type: 'UPDATE_OBJECT_ENTITY_REFS', payload: { id, entityRefs } });
      }
    }

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
