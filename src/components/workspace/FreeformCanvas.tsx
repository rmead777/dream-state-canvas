import { useRef, useCallback, useState, useEffect } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WorkspaceObjectWrapper } from './WorkspaceObject';
import { FusionZone } from './FusionZone';
import { executeFusion } from '@/lib/fusion-executor';
import { canFuse, getFusionOutputType } from '@/lib/fusion-rules';
import { toast } from '@/hooks/use-toast';

const FUSION_THRESHOLD = 120;
const FUSION_GLOW_THRESHOLD = 200;

export function FreeformCanvas() {
  const { state, dispatch } = useWorkspace();
  const { objects } = state;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [fusionTarget, setFusionTarget] = useState<{ sourceId: string; targetId: string } | null>(null);
  const [fusionProcessing, setFusionProcessing] = useState(false);
  const [fusionProximity, setFusionProximity] = useState<{ sourceId: string; targetId: string; intensity: number } | null>(null);
  const [_activeDragId, setActiveDragId] = useState<string | null>(null);

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

  // Live proximity detection during drag
  const handleDragMove = useCallback(
    (draggedId: string) => {
      const draggedObj = objects[draggedId];
      if (!draggedObj?.freeformPosition) return;

      let closest: { id: string; dist: number } | null = null;

      for (const other of Object.values(objects)) {
        if (other.id === draggedId || other.status === 'dissolved' || other.status === 'collapsed' || !other.freeformPosition) continue;
        if (!canFuse(draggedObj.type, other.type)) continue;
        const dx = Math.abs(draggedObj.freeformPosition.x - other.freeformPosition.x);
        const dy = Math.abs(draggedObj.freeformPosition.y - other.freeformPosition.y);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < FUSION_GLOW_THRESHOLD && (!closest || dist < closest.dist)) {
          closest = { id: other.id, dist };
        }
      }

      if (closest) {
        const intensity = Math.max(0, Math.min(1, 1 - (closest.dist / FUSION_GLOW_THRESHOLD)));
        setFusionProximity({ sourceId: draggedId, targetId: closest.id, intensity });
      } else {
        setFusionProximity(null);
      }
    },
    [objects]
  );

  // Fusion detection — when a dragged object overlaps another
  const handleDragEnd = useCallback(
    (draggedId: string) => {
      setActiveDragId(null);
      setFusionProximity(null);
      const draggedObj = objects[draggedId];
      if (!draggedObj?.freeformPosition) return;

      for (const other of visibleObjects) {
        if (other.id === draggedId || !other.freeformPosition) continue;
        if (!canFuse(draggedObj.type, other.type)) continue;
        const dx = Math.abs(draggedObj.freeformPosition.x - other.freeformPosition.x);
        const dy = Math.abs(draggedObj.freeformPosition.y - other.freeformPosition.y);
        if (dx < FUSION_THRESHOLD && dy < FUSION_THRESHOLD) {
          setFusionTarget({ sourceId: draggedId, targetId: other.id });
          return;
        }
      }
    },
    [objects, visibleObjects]
  );

  const handleDragStart = useCallback((id: string) => {
    setActiveDragId(id);
  }, []);

  const handleFuse = useCallback(async () => {
    if (!fusionTarget) return;
    setFusionProcessing(true);

    const source = objects[fusionTarget.sourceId];
    const target = objects[fusionTarget.targetId];

    const result = await executeFusion(source, target);

    if (!result.success) {
      if (result.lowValue) {
        toast({ title: 'Fusion not productive', description: result.errorMessage });
      } else {
        dispatch({ type: 'SET_SHERPA_RESPONSE', payload: result.errorMessage || 'Fusion failed.' });
      }
      setFusionProcessing(false);
      setFusionTarget(null);
      return;
    }

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
        freeformPosition: {
          x: ((source.freeformPosition?.x ?? 200) + (target.freeformPosition?.x ?? 400)) / 2,
          y: Math.max(source.freeformPosition?.y ?? 100, target.freeformPosition?.y ?? 100) + 120,
        },
      },
    });

    dispatch({ type: 'SET_SHERPA_RESPONSE', payload: `Synthesized "${source.title}" and "${target.title}" into a new insight.` });
    setTimeout(() => dispatch({ type: 'OPEN_OBJECT', payload: { id: result.id! } }), 400);

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
          <div className="workspace-card-surface max-w-md rounded-[28px] border border-workspace-border/45 px-7 py-7 text-center shadow-[0_22px_52px_rgba(15,23,42,0.08)]">
            <span className="workspace-pill inline-flex rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/75">
              Freeform canvas
            </span>
            <div className="mx-auto mt-4 mb-6 h-px w-16 bg-workspace-border" />
            <p className="text-sm text-workspace-text leading-relaxed">
              The freeform layer is empty. Materialize a few objects first, then drag them here to compare, cluster, or fuse.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {['Voice input', 'Ctrl/⌘ K', 'Drag to fuse'].map((hint) => (
                <span key={hint} className="workspace-pill rounded-full px-3 py-1.5 text-[11px] text-workspace-text-secondary">
                  {hint}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : (
        visibleObjects.map((obj) => {
          const isGlowing = fusionProximity &&
            (fusionProximity.sourceId === obj.id || fusionProximity.targetId === obj.id);
          const glowIntensity = isGlowing ? fusionProximity.intensity : 0;

          return (
            <DraggableFreeformObject
              key={obj.id}
              object={obj}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              fusionGlow={glowIntensity}
            />
          );
        })
      )}

      {/* Fusion proximity connector line */}
      {fusionProximity && fusionProximity.intensity > 0.2 && (
        <FusionProximityLine
          source={objects[fusionProximity.sourceId]?.freeformPosition}
          target={objects[fusionProximity.targetId]?.freeformPosition}
          intensity={fusionProximity.intensity}
        />
      )}
    </div>
  );
}

function FusionProximityLine({
  source,
  target,
  intensity,
}: {
  source?: { x: number; y: number };
  target?: { x: number; y: number };
  intensity: number;
}) {
  if (!source || !target) return null;
  const x1 = source.x + 210;
  const y1 = source.y + 60;
  const x2 = target.x + 210;
  const y2 = target.y + 60;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  return (
    <svg className="absolute inset-0 pointer-events-none z-[60]" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="fusion-grad" x1={x1} y1={y1} x2={x2} y2={y2} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="hsl(var(--workspace-accent))" stopOpacity={intensity * 0.6} />
          <stop offset="50%" stopColor="hsl(var(--workspace-accent))" stopOpacity={intensity * 0.9} />
          <stop offset="100%" stopColor="hsl(var(--workspace-accent))" stopOpacity={intensity * 0.6} />
        </linearGradient>
      </defs>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke="url(#fusion-grad)"
        strokeWidth={2 + intensity * 2}
        strokeDasharray={`${4 + intensity * 4} ${6 - intensity * 3}`}
        className="animate-[dash_1s_linear_infinite]"
      />
      {intensity > 0.6 && (
        <g>
          <circle cx={midX} cy={midY} r={6 + intensity * 6} fill="hsl(var(--workspace-accent))" opacity={intensity * 0.15} />
          <circle cx={midX} cy={midY} r={3} fill="hsl(var(--workspace-accent))" opacity={intensity * 0.6} />
          <text x={midX} y={midY + 1} textAnchor="middle" dominantBaseline="central" fontSize="6" fill="hsl(var(--workspace-accent))" opacity={intensity}>
            ✦
          </text>
        </g>
      )}
    </svg>
  );
}

function DraggableFreeformObject({
  object,
  onDragStart,
  onDragMove,
  onDragEnd,
  fusionGlow,
}: {
  object: ReturnType<typeof useWorkspace>['state']['objects'][string];
  onDragStart: (id: string) => void;
  onDragMove: (id: string) => void;
  onDragEnd: (id: string) => void;
  fusionGlow: number;
}) {
  const { dispatch } = useWorkspace();
  const [dragging, setDragging] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const dragStart = useRef<{ pointerId: number; mouseX: number; mouseY: number; objX: number; objY: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pos = object.freeformPosition ?? { x: 100, y: 100 };

  const finishDrag = useCallback(() => {
    const active = dragStart.current;
    if (active && rootRef.current?.hasPointerCapture(active.pointerId)) {
      rootRef.current.releasePointerCapture(active.pointerId);
    }
    setDragging(false);
    dragStart.current = null;
    onDragEnd(object.id);
  }, [object.id, onDragEnd]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      // Only start drag from the freeform handle area, but not from buttons/inputs
      if (!target.closest('[data-freeform-handle]')) return;
      if (target.closest('button') || target.closest('input') || target.closest('a')) return;

      e.preventDefault();
      setDragging(true);
      setShowHint(false);
      onDragStart(object.id);
      dragStart.current = {
        pointerId: e.pointerId,
        mouseX: e.clientX,
        mouseY: e.clientY,
        objX: pos.x,
        objY: pos.y,
      };

      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [pos, object.id, onDragStart]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStart.current) return;
      const dx = e.clientX - dragStart.current.mouseX;
      const dy = e.clientY - dragStart.current.mouseY;
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
      onDragMove(object.id);
    },
    [object.id, dispatch, onDragMove]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStart.current || dragStart.current.pointerId !== e.pointerId) return;
      finishDrag();
    },
    [finishDrag]
  );

  const handlePointerCancel = useCallback(() => {
    if (!dragStart.current) return;
    finishDrag();
  }, [finishDrag]);

  const glowShadow = fusionGlow > 0
    ? `0 0 ${12 + fusionGlow * 24}px ${fusionGlow * 8}px hsl(var(--workspace-accent) / ${fusionGlow * 0.3}), 0 0 ${4 + fusionGlow * 12}px ${fusionGlow * 4}px hsl(var(--workspace-accent) / ${fusionGlow * 0.15})`
    : undefined;

  return (
    <div
      ref={rootRef}
      className={`absolute transition-shadow duration-150 ${
        dragging ? 'z-50 shadow-2xl' : 'z-10'
      } ${fusionGlow > 0.5 ? 'scale-[1.01]' : ''}`}
      style={{
        left: pos.x,
        top: pos.y,
        width: 420,
        minWidth: 320,
        maxWidth: 560,
        boxShadow: glowShadow,
        transition: dragging
          ? 'box-shadow 0.15s cubic-bezier(0.34,1.56,0.64,1)'
          : 'box-shadow 0.3s cubic-bezier(0.34,1.56,0.64,1), transform 0.2s cubic-bezier(0.34,1.56,0.64,1)',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerEnter={() => setShowHint(true)}
      onPointerLeave={() => setShowHint(false)}
    >
      {showHint && !dragging && (
        <div className="pointer-events-none absolute -top-8 left-4 z-30 rounded-full border border-workspace-accent/15 bg-white/80 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-workspace-accent/70 shadow-[0_10px_25px_rgba(99,102,241,0.12)] backdrop-blur-sm animate-[materialize_0.18s_cubic-bezier(0.34,1.56,0.64,1)_forwards]">
          Drag to compare or fuse
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none absolute -bottom-8 left-4 z-30 rounded-full border border-workspace-accent/15 bg-workspace-accent/8 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-workspace-accent/80 shadow-[0_10px_25px_rgba(99,102,241,0.12)] backdrop-blur-sm animate-[materialize_0.18s_cubic-bezier(0.34,1.56,0.64,1)_forwards]">
          Release near another object to fuse
        </div>
      )}

      {fusionGlow > 0.5 && (
        <div
          className="absolute -inset-1 rounded-2xl pointer-events-none"
          style={{
            border: `1.5px solid hsl(var(--workspace-accent) / ${fusionGlow * 0.4})`,
            animation: 'pulse 1.5s cubic-bezier(0.34,1.56,0.64,1) infinite',
          }}
        />
      )}

      {fusionGlow > 0.35 && !dragging && (
        <div className="pointer-events-none absolute inset-x-5 -bottom-4 z-20 rounded-full border border-workspace-accent/20 bg-white/80 px-3 py-1 text-center text-[10px] uppercase tracking-[0.18em] text-workspace-accent/80 shadow-[0_14px_28px_rgba(99,102,241,0.12)] backdrop-blur-sm animate-[materialize_0.18s_cubic-bezier(0.34,1.56,0.64,1)_forwards]">
          Fusion candidate nearby
        </div>
      )}

      {/* Drag handle covers the entire header area — use data attribute for detection */}
      <div data-freeform-handle className="absolute inset-x-0 top-0 h-14 cursor-grab active:cursor-grabbing z-20 rounded-t-xl" />
      <WorkspaceObjectWrapper object={object} />
    </div>
  );
}
