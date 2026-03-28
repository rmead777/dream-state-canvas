import { useCallback, useRef } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { parseIntentAI, parseIntent, refineDataRules, invalidateProfileCache } from '@/lib/intent-engine';
import { callAI } from '@/hooks/useAI';
import { generateSuggestions } from '@/lib/sherpa-engine';
import { WorkspaceObject, IntentOrigin } from '@/lib/workspace-types';
import { computeFreeformPosition } from '@/lib/freeform-placement';
import { executeFusion } from '@/lib/fusion-executor';
import { toast } from '@/hooks/use-toast';
import { getActiveDataset } from '@/lib/active-dataset';
import { previewRows, alertRows, metricAggregate, comparisonPairs } from '@/lib/data-slicer';
import { buildDocumentObjectContext, resolveDocumentRecord } from '@/lib/document-store';

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

      try {
        const result = await parseIntentAI(query, state.objects, _documentIdsRef);
        await applyResult(result, origin);
      } catch {
        const result = await parseIntent(query, state.objects);
        await applyResult(result, origin);
      }

      dispatch({ type: 'SET_SHERPA_PROCESSING', payload: false });
    },
    [state.objects, state.layoutMode, dispatch]
  );

  async function applyResult(result: { actions: any[] }, origin: IntentOrigin) {
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

        case 'update': {
          const target = state.objects[action.objectId];
          if (!target) {
            dispatch({ type: 'SET_SHERPA_RESPONSE', payload: 'Could not find the specified object to update.' });
            break;
          }
          // Await the full update — processing animation stays visible
          await (async () => {
            try {
              const { columns, rows } = getActiveDataset();
              const profile = await import('@/lib/data-analyzer').then(m => m.getCurrentProfile(columns, rows));

              // Let AI parse the instruction into structured filter params — no regex
              const parseResult = await callAI(
                [{ role: 'user', content: `You are a data filter parser. Given a user instruction about modifying a data view, extract structured filter parameters.

Instruction: "${action.instruction}"

Available columns in the dataset: ${columns.join(', ')}

Return ONLY valid JSON (no markdown, no explanation):
{
  "limit": <number or null - how many rows to show>,
  "tierFilter": "<exact tier label to filter by, e.g. 'Tier 1' — or null>",
  "columnFilter": { "column": "<column name>", "value": "<filter value>" } or null,
  "sortBy": "<column name or null>",
  "sortDirection": "<'asc' or 'desc' or null>",
  "textSearch": "<keyword to search across all columns, or null>"
}` }],
                'intent'
              );

              let limit: number | undefined;
              let tierFilter: string | undefined;
              let textSearch: string | undefined;
              let columnFilter: { column: string; value: string } | undefined;

              if (parseResult) {
                try {
                  const jsonMatch = parseResult.match(/\{[\s\S]*\}/);
                  if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.limit) limit = parsed.limit;
                    if (parsed.tierFilter) tierFilter = parsed.tierFilter;
                    if (parsed.textSearch) textSearch = parsed.textSearch;
                    if (parsed.columnFilter?.column && parsed.columnFilter?.value) {
                      columnFilter = parsed.columnFilter;
                    }
                  }
                } catch { /* AI returned unparseable — proceed without filters */ }
              }

              // Apply filters to rows
              function applyFilters(sourceRows: string[][]): string[][] {
                let filtered = sourceRows;
                if (tierFilter && profile?.ordinalPriorityColumn) {
                  const col = profile.ordinalPriorityColumn.column;
                  const colIdx = columns.indexOf(col);
                  if (colIdx >= 0) {
                    filtered = filtered.filter(r => String(r[colIdx]).includes(tierFilter!));
                  }
                }
                if (columnFilter) {
                  const colIdx = columns.indexOf(columnFilter.column);
                  if (colIdx >= 0) {
                    const val = columnFilter.value.toLowerCase();
                    filtered = filtered.filter(r => String(r[colIdx]).toLowerCase().includes(val));
                  }
                }
                if (textSearch) {
                  const lower = textSearch.toLowerCase();
                  filtered = filtered.filter(r => r.some(cell => String(cell).toLowerCase().includes(lower)));
                }
                const sorted = previewRows(columns, filtered, profile!, filtered.length);
                return limit ? sorted.rows.slice(0, limit) : sorted.rows;
              }

              let newContext: Record<string, any> = target.context;

              switch (target.type) {
                case 'inspector':
                case 'dataset': {
                  const filteredRows = applyFilters(rows);
                  newContext = { columns, rows: filteredRows };
                  break;
                }
                case 'alert': {
                  let filteredRows = rows;
                  if (tierFilter && profile?.ordinalPriorityColumn) {
                    const col = profile.ordinalPriorityColumn.column;
                    const colIdx = columns.indexOf(col);
                    if (colIdx >= 0) {
                      filteredRows = filteredRows.filter(r => String(r[colIdx]).includes(tierFilter!));
                    }
                  }
                  const alerts = alertRows(columns, filteredRows, profile!);
                  newContext = { alerts: limit ? alerts.slice(0, limit) : alerts };
                  break;
                }
                case 'comparison': {
                  const comp = comparisonPairs(columns, rows, profile!);
                  newContext = comp;
                  break;
                }
                case 'brief': {
                  // Update BOTH table data and text
                  if (target.context.columns && target.context.rows) {
                    const filteredRows = applyFilters(rows);
                    newContext = { ...target.context, columns, rows: filteredRows };
                  }
                  const briefResult = await callAI(
                    [{ role: 'user', content: `Current brief context: ${JSON.stringify({ ...target.context, rows: target.context.rows?.slice(0, 10) })}\n\nUser instruction: "${action.instruction}"\n\nRegenerate the brief content incorporating this change. The data has been filtered to ${limit ? `top ${limit}` : 'match the criteria'}. Return ONLY markdown text, no JSON wrapper.` }],
                    'brief',
                    _documentIdsRef
                  );
                  if (briefResult) {
                    newContext = { ...newContext, content: briefResult };
                  }
                  break;
                }
                case 'metric': {
                  const agg = metricAggregate(columns, rows, profile!);
                  newContext = { ...target.context, ...agg };
                  break;
                }
              }

              dispatch({ type: 'UPDATE_OBJECT_CONTEXT', payload: { id: target.id, context: newContext } });
              dispatch({ type: 'TOUCH_OBJECT', payload: { id: target.id } });
              dispatch({ type: 'FOCUS_OBJECT', payload: { id: target.id } });
              dispatch({ type: 'SET_SHERPA_RESPONSE', payload: `Updated "${target.title}" — ${action.instruction}.` });
            } catch (e) {
              dispatch({ type: 'SET_SHERPA_RESPONSE', payload: `Could not update "${target.title}". Try a different instruction.` });
            }
          })();
          break;
        }

        case 'fuse': {
          const objA = state.objects[action.objectIdA];
          const objB = state.objects[action.objectIdB];
          if (!objA || !objB) {
            dispatch({ type: 'SET_SHERPA_RESPONSE', payload: 'Could not find the specified objects to fuse.' });
            break;
          }
          await (async () => {
            const result = await executeFusion(objA, objB);
            if (!result.success) {
              if (result.lowValue) {
                toast({ title: 'Fusion not productive', description: result.errorMessage });
              }
              dispatch({ type: 'SET_SHERPA_RESPONSE', payload: result.errorMessage || 'Fusion failed.' });
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
          })();
          break;
        }

        case 'refine-rules': {
          await (async () => {
            try {
              const updatedProfile = await refineDataRules(action.feedback);
              
              const { columns, rows } = getActiveDataset();
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
    setDocumentIds,
    collapseObject,
    restoreObject,
    dissolveObject,
    pinObject,
    unpinObject,
    focusObject,
  };
}
