import { useRef, useCallback, useState, useEffect } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WorkspaceObjectWrapper } from './WorkspaceObject';
import { FreeformPosition } from '@/lib/workspace-types';

export function FreeformCanvas() {
  const { state, dispatch } = useWorkspace();
  const { objects } = state;
  const canvasRef = useRef<HTMLDivElement>(null);

  const visibleObjects = Object.values(objects).filter(
    (o) => o.status !== 'dissolved' && o.status !== 'collapsed'
  );

  // Assign default freeform positions to objects that don't have one yet
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

  return (
    <div
      ref={canvasRef}
      className="flex-1 relative overflow-auto"
      style={{ minHeight: '100%' }}
    >
      {visibleObjects.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-6 h-px w-16 bg-workspace-border" />
            <p className="text-sm text-workspace-text-secondary/50 leading-relaxed">
              Your workspace is clear. Ask the Sherpa to surface what matters.
            </p>
          </div>
        </div>
      ) : (
        visibleObjects.map((obj) => (
          <DraggableFreeformObject key={obj.id} object={obj} />
        ))
      )}
    </div>
  );
}

function DraggableFreeformObject({
  object,
}: {
  object: ReturnType<typeof useWorkspace>['state']['objects'][string];
}) {
  const { dispatch } = useWorkspace();
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ mouseX: number; mouseY: number; objX: number; objY: number } | null>(null);
  const pos = object.freeformPosition ?? { x: 100, y: 100 };

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only start drag from the handle area (data attribute)
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
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [pos, object.id, dispatch]
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
