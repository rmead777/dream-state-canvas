import { useCallback } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { parseIntentAI, parseIntent, refineDataRules, invalidateProfileCache } from '@/lib/intent-engine';
import { generateSuggestions } from '@/lib/sherpa-engine';
import { WorkspaceObject, IntentOrigin } from '@/lib/workspace-types';
import { computeFreeformPosition } from '@/lib/freeform-placement';
import { executeFusion } from '@/lib/fusion-executor';
import { toast } from '@/hooks/use-toast';
import { CANONICAL_DATASET } from '@/lib/seed-data';
import { previewRows, alertRows, metricAggregate, comparisonPairs } from '@/lib/data-slicer';

let objectCounter = 0;

export function useWorkspaceActions() {
  const { state, dispatch } = useWorkspace();

  const processIntent = useCallback(
    async (query: string) => {
      dispatch({ type: 'SET_SHERPA_PROCESSING', payload: true });

      const origin: IntentOrigin = { type: 'user-query', query };
      dispatch({ type: 'ADD_RECENT_INTENT', payload: origin });

      try {
        // Try AI-powered intent parsing first
        const result = await parseIntentAI(query, state.objects);
        applyResult(result, origin);
      } catch {
        // Fallback to keyword matching
        const result = await parseIntent(query, state.objects);
        applyResult(result, origin);
      }

      dispatch({ type: 'SET_SHERPA_PROCESSING', payload: false });
    },
    [state.objects, state.layoutMode, dispatch]
  );

  function applyResult(result: { actions: any[] }, origin: IntentOrigin) {
    for (const action of result.actions) {
      switch (action.type) {
        case 'respond':
          dispatch({ type: 'SET_SHERPA_RESPONSE', payload: action.message });
          break;

        case 'create': {
          objectCounter++;
          const id = `wo-${Date.now()}-${objectCounter}`;
          const relationships = action.relatedTo ?? [];
          const freeformPosition =
            state.layoutMode === 'freeform'
              ? computeFreeformPosition(state.objects, { relationships }, window.innerWidth, window.innerHeight)
              : undefined;
          const obj: Omit<WorkspaceObject, 'status' | 'createdAt' | 'lastInteractedAt'> = {
            id,
            type: action.objectType,
            title: action.title,
            pinned: false,
            origin,
            relationships,
            context: action.data,
            position: { zone: 'primary', order: 0 },
            freeformPosition,
          };
          dispatch({ type: 'MATERIALIZE_OBJECT', payload: obj });

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

        case 'fuse': {
          const objA = state.objects[action.objectIdA];
          const objB = state.objects[action.objectIdB];
          if (!objA || !objB) {
            dispatch({ type: 'SET_SHERPA_RESPONSE', payload: 'Could not find the specified objects to fuse.' });
            break;
          }
          // Run fusion asynchronously
          (async () => {
            dispatch({ type: 'SET_SHERPA_PROCESSING', payload: true });
            const result = await executeFusion(objA, objB);
            if (!result.success) {
              if (result.lowValue) {
                toast({ title: 'Fusion not productive', description: result.errorMessage });
              }
              dispatch({ type: 'SET_SHERPA_RESPONSE', payload: result.errorMessage || 'Fusion failed.' });
              dispatch({ type: 'SET_SHERPA_PROCESSING', payload: false });
              return;
            }

            const freeformPosition =
              state.layoutMode === 'freeform'
                ? {
                    x: ((objA.freeformPosition?.x ?? 200) + (objB.freeformPosition?.x ?? 400)) / 2,
                    y: Math.max(objA.freeformPosition?.y ?? 100, objB.freeformPosition?.y ?? 100) + 120,
                  }
                : undefined;

            dispatch({
              type: 'MATERIALIZE_OBJECT',
              payload: {
                id: result.id!,
                type: 'brief',
                title: result.title!,
                pinned: false,
                origin: { type: 'fusion' as any, query: `Fusion of ${objA.title} and ${objB.title}` },
                relationships: [objA.id, objB.id],
                context: result.context!,
                position: { zone: 'primary', order: 0 },
                freeformPosition,
              },
            });
            dispatch({ type: 'SET_SHERPA_RESPONSE', payload: `Synthesized "${objA.title}" and "${objB.title}" into a new insight.` });
            setTimeout(() => dispatch({ type: 'OPEN_OBJECT', payload: { id: result.id! } }), 400);
            dispatch({ type: 'SET_SHERPA_PROCESSING', payload: false });
          })();
          break;
        }

        case 'refine-rules': {
          (async () => {
            dispatch({ type: 'SET_SHERPA_PROCESSING', payload: true });
            try {
              const updatedProfile = await refineDataRules(action.feedback);
              
              // Refresh all data-derived objects with new rules
              const { columns, rows } = CANONICAL_DATASET;
              const dataObjects = Object.values(state.objects).filter(
                o => ['metric', 'inspector', 'alert', 'comparison'].includes(o.type) && o.status !== 'dissolved'
              );
              
              for (const obj of dataObjects) {
                let newContext: Record<string, any> = obj.context;
                switch (obj.type) {
                  case 'metric': {
                    const agg = metricAggregate(columns, rows, updatedProfile);
                    newContext = { ...obj.context, ...agg };
                    break;
                  }
                  case 'inspector': {
                    const preview = previewRows(columns, rows, updatedProfile, 8);
                    newContext = { columns: preview.columns, rows: preview.rows };
                    break;
                  }
                  case 'alert': {
                    const alerts = alertRows(columns, rows, updatedProfile);
                    newContext = { alerts };
                    break;
                  }
                  case 'comparison': {
                    const comp = comparisonPairs(columns, rows, updatedProfile);
                    newContext = comp;
                    break;
                  }
                }
                dispatch({ type: 'UPDATE_OBJECT_CONTEXT', payload: { id: obj.id, context: newContext } });
              }

              const changes = [];
              if (updatedProfile.primaryMeasureColumn) changes.push(`sorting by ${updatedProfile.primaryMeasureColumn}`);
              if (updatedProfile.groupByColumn) changes.push(`grouping by ${updatedProfile.groupByColumn}`);
              if (updatedProfile.sortDirection) changes.push(`${updatedProfile.sortDirection}ending order`);
              
              dispatch({
                type: 'SET_SHERPA_RESPONSE',
                payload: `Rules updated: ${changes.join(', ')}. ${dataObjects.length} cards refreshed with new prioritization.`,
              });
              toast({ title: 'Rules updated', description: `Data prioritization refreshed for ${dataObjects.length} objects.` });
            } catch (e) {
              dispatch({ type: 'SET_SHERPA_RESPONSE', payload: 'Could not update rules. Try being more specific about what to change.' });
            }
            dispatch({ type: 'SET_SHERPA_PROCESSING', payload: false });
          })();
          break;
        }
      }
    }

    // Update suggestions
    setTimeout(() => {
      const suggestions = generateSuggestions(state.objects);
      dispatch({ type: 'SET_SHERPA_SUGGESTIONS', payload: suggestions });
    }, 100);
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
    collapseObject,
    restoreObject,
    dissolveObject,
    pinObject,
    unpinObject,
    focusObject,
  };
}
