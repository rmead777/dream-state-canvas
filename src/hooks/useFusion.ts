/**
 * useFusion — shared fusion execution logic for both PanelCanvas and FreeformCanvas.
 *
 * Extracts the duplicated drag-and-drop fusion handler (ME-012 fix).
 * Both canvases call this with their fusionTarget state; the hook handles
 * execution, dispatch, error handling, and cleanup.
 */
import { useCallback } from 'react';
import { useWorkspaceDispatch } from '@/contexts/WorkspaceContext';
import { WorkspaceObject } from '@/lib/workspace-types';
import { executeFusion } from '@/lib/fusion-executor';
import { getFusionOutputType } from '@/lib/fusion-rules';
import { toast } from '@/hooks/use-toast';

interface FusionTarget {
  sourceId: string;
  targetId: string;
}

interface UseFusionParams {
  objects: Record<string, WorkspaceObject>;
  fusionTarget: FusionTarget | null;
  layoutMode: 'auto' | 'freeform';
  onComplete: () => void; // caller clears fusionTarget + processing state
}

export function useFusion({ objects, fusionTarget, layoutMode, onComplete }: UseFusionParams) {
  const dispatch = useWorkspaceDispatch();

  const handleFuse = useCallback(async () => {
    if (!fusionTarget) return;
    dispatch({ type: 'SET_SHERPA_PROCESSING', payload: true });

    const source = objects[fusionTarget.sourceId];
    const target = objects[fusionTarget.targetId];

    const result = await executeFusion(source, target);

    if (!result.success) {
      if (result.lowValue) {
        toast({ title: 'Fusion not productive', description: result.errorMessage });
      } else {
        dispatch({ type: 'SET_SHERPA_RESPONSE', payload: result.errorMessage || 'Fusion failed.' });
      }
      dispatch({ type: 'SET_SHERPA_PROCESSING', payload: false });
      onComplete();
      return;
    }

    // Compute freeform position only for freeform layout
    const freeformPosition = layoutMode === 'freeform' ? {
      x: ((source.freeformPosition?.x ?? 200) + (target.freeformPosition?.x ?? 400)) / 2,
      y: Math.max(source.freeformPosition?.y ?? 100, target.freeformPosition?.y ?? 100) + 120,
    } : undefined;

    dispatch({
      type: 'MATERIALIZE_OBJECT',
      payload: {
        id: result.id!,
        type: getFusionOutputType(source.type, target.type),
        title: result.title!,
        pinned: false,
        origin: { type: 'cross-object', sourceObjectId: source.id, query: `Fusion of ${source.title} and ${target.title}` },
        relationships: [source.id, target.id],
        context: result.context!,
        position: { zone: 'primary', order: 0 },
        freeformPosition,
      },
    });

    dispatch({
      type: 'SET_SHERPA_RESPONSE',
      payload: `Synthesized "${source.title}" and "${target.title}" into a new insight.`,
    });
    setTimeout(() => dispatch({ type: 'OPEN_OBJECT', payload: { id: result.id! } }), 400);
    dispatch({ type: 'SET_SHERPA_PROCESSING', payload: false });
    onComplete();
  }, [fusionTarget, objects, layoutMode, dispatch, onComplete]);

  return { handleFuse };
}
