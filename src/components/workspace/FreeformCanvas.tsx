import { useRef, useCallback, useState, useEffect } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { WorkspaceObjectWrapper } from './WorkspaceObject';
import { FusionZone } from './FusionZone';
import { callAI } from '@/hooks/useAI';

export function FreeformCanvas() {
  const { state, dispatch } = useWorkspace();
  const { processIntent } = useWorkspaceActions();
  const { objects } = state;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [fusionTarget, setFusionTarget] = useState<{ sourceId: string; targetId: string } | null>(null);
  const [fusionProcessing, setFusionProcessing] = useState(false);

  const visibleObjects = Object.values(objects).filter(
    (o) => o.status !== 'dissolved' && o.status !== 'collapsed'
  );

  // Assign default freeform positions
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    for (const obj of visibleObjects) {
      if (!obj.freeformPosition) {
        const count = visibleObjects.filter((o) => o.freeformPosition).length;
        const centerX = Math.max(40, (rect.width - 420) / 2);
        const centerY = Math.max(40, (rect.height - 280) / 3);
        dispatch({
          type: 'UPDATE_FREEFORM_POSITION',
          payload: {
            id: obj.id,
            position: { x: centerX + count * 40, y: centerY + count * 40 },
          },
        });
      }
    }
  }, [visibleObjects.length]);

  // Fusion detection — when a dragged object overlaps another
  const handleDragEnd = useCallback(
    (draggedId: string) => {
      const draggedObj = objects[draggedId];
      if (!draggedObj?.freeformPosition) return;

      for (const other of visibleObjects) {
        if (other.id === draggedId || !other.freeformPosition) continue;
        const dx = Math.abs(draggedObj.freeformPosition.x - other.freeformPosition.x);
        const dy = Math.abs(draggedObj.freeformPosition.y - other.freeformPosition.y);
        // Overlap threshold
        if (dx < 100 && dy < 80) {
          setFusionTarget({ sourceId: draggedId, targetId: other.id });
          return;
        }
      }
    },
    [objects, visibleObjects]
  );

  const handleFuse = useCallback(async () => {
    if (!fusionTarget) return;
    setFusionProcessing(true);

    const source = objects[fusionTarget.sourceId];
    const target = objects[fusionTarget.targetId];

    try {
      const result = await callAI(
        [
          {
            role: 'user',
            content: `Synthesize these two workspace objects:
Object 1: [${source.type}] "${source.title}" — ${JSON.stringify(source.context).slice(0, 500)}
Object 2: [${target.type}] "${target.title}" — ${JSON.stringify(target.context).slice(0, 500)}

Create a meaningful synthesis.`,
          },
        ],
        'fusion'
      );

      let title = `${source.title} ✦ ${target.title}`;
      let summary = result || 'Synthesis of both objects.';
      let insights: string[] = [];

      try {
        const jsonMatch = (result || '').match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.title) title = parsed.title;
          if (parsed.summary) summary = parsed.summary;
          if (parsed.insights) insights = parsed.insights;
        }
      } catch { /* use raw text as summary */ }

      // Directly materialize the fusion object with AI-generated content
      const id = `wo-fusion-${Date.now()}`;
      const fusionData = {
        summary,
        insights: insights.length > 0 ? insights : [summary],
        sourceObjects: [
          { id: source.id, type: source.type, title: source.title },
          { id: target.id, type: target.type, title: target.title },
        ],
        generatedAt: new Date().toISOString(),
      };

      dispatch({
        type: 'MATERIALIZE_OBJECT',
        payload: {
          id,
          type: 'brief',
          title,
          pinned: false,
          origin: { type: 'fusion' as any, query: `Fusion of ${source.title} and ${target.title}` },
          relationships: [source.id, target.id],
          context: fusionData,
          position: { zone: 'primary', order: 0 },
          freeformPosition: {
            x: ((source.freeformPosition?.x ?? 200) + (target.freeformPosition?.x ?? 400)) / 2,
            y: Math.max(source.freeformPosition?.y ?? 100, target.freeformPosition?.y ?? 100) + 120,
          },
        },
      });

      dispatch({ type: 'SET_SHERPA_RESPONSE', payload: `Synthesized "${source.title}" and "${target.title}" into a new insight.` });

      setTimeout(() => {
        dispatch({ type: 'OPEN_OBJECT', payload: { id } });
      }, 400);
    } catch {
      dispatch({ type: 'SET_SHERPA_RESPONSE', payload: 'Fusion failed — try again or ask the Sherpa directly.' });
    }

    setFusionProcessing(false);
    setFusionTarget(null);
  }, [fusionTarget, objects, dispatch]);

  return (
    <div
      ref={canvasRef}
      className="flex-1 relative overflow-auto"
      style={{ minHeight: '100%' }}
    >
      {fusionTarget && (
        <FusionZone
          sourceTitle={objects[fusionTarget.sourceId]?.title || ''}
          targetTitle={objects[fusionTarget.targetId]?.title || ''}
          onFuse={handleFuse}
          onCancel={() => setFusionTarget(null)}
          isProcessing={fusionProcessing}
        />
      )}

      {visibleObjects.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-6 h-px w-16 bg-workspace-border" />
            <p className="text-sm text-workspace-text-secondary/50 leading-relaxed">
              Your workspace is clear. Ask the Sherpa to surface what matters.
            </p>
            <p className="mt-2 text-[10px] text-workspace-text-secondary/30">
              Try voice input, ⌘K, or type in the Sherpa rail
            </p>
          </div>
        </div>
      ) : (
        visibleObjects.map((obj) => (
          <DraggableFreeformObject key={obj.id} object={obj} onDragEnd={handleDragEnd} />
        ))
      )}
    </div>
  );
}

function DraggableFreeformObject({
  object,
  onDragEnd,
}: {
  object: ReturnType<typeof useWorkspace>['state']['objects'][string];
  onDragEnd: (id: string) => void;
}) {
  const { dispatch } = useWorkspace();
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ mouseX: number; mouseY: number; objX: number; objY: number } | null>(null);
  const pos = object.freeformPosition ?? { x: 100, y: 100 };

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-freeform-handle]')) return;

      e.preventDefault();
      setDragging(true);
      dragStart.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        objX: pos.x,
        objY: pos.y,
      };

      const onMove = (ev: MouseEvent) => {
        if (!dragStart.current) return;
        const dx = ev.clientX - dragStart.current.mouseX;
        const dy = ev.clientY - dragStart.current.mouseY;
        dispatch({
          type: 'UPDATE_FREEFORM_POSITION',
          payload: {
            id: object.id,
            position: {
              x: Math.max(0, dragStart.current.objX + dx),
              y: Math.max(0, dragStart.current.objY + dy),
            },
          },
        });
      };

      const onUp = () => {
        setDragging(false);
        dragStart.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        onDragEnd(object.id);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [pos, object.id, dispatch, onDragEnd]
  );

  return (
    <div
      className={`absolute transition-shadow duration-200 ${
        dragging ? 'z-50 shadow-2xl' : 'z-10'
      }`}
      style={{
        left: pos.x,
        top: pos.y,
        width: 420,
        minWidth: 320,
        maxWidth: 560,
      }}
      onMouseDown={handleMouseDown}
    >
      <div data-freeform-handle className="absolute inset-x-0 top-0 h-12 cursor-grab active:cursor-grabbing z-20" />
      <WorkspaceObjectWrapper object={object} />
    </div>
  );
}
