import { useRef, useCallback, useState, useEffect } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { WorkspaceObjectWrapper } from './WorkspaceObject';
import { FusionZone } from './FusionZone';
import { callAI } from '@/hooks/useAI';
import { canFuse, SynthesisType } from '@/lib/fusion-rules';
import { toast } from '@/hooks/use-toast';

const FUSION_THRESHOLD = 120;
const FUSION_GLOW_THRESHOLD = 200;

export function FreeformCanvas() {
  const { state, dispatch } = useWorkspace();
  const { processIntent } = useWorkspaceActions();
  const { objects } = state;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [fusionTarget, setFusionTarget] = useState<{ sourceId: string; targetId: string } | null>(null);
  const [fusionProcessing, setFusionProcessing] = useState(false);
  const [fusionProximity, setFusionProximity] = useState<{ sourceId: string; targetId: string; intensity: number } | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

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

    try {
      const result = await callAI(
        [
          {
            role: 'user',
            content: `Fuse these two workspace objects into a single, original analytical synthesis.

OBJECT A — [${source.type}] "${source.title}":
${JSON.stringify(source.context).slice(0, 800)}

OBJECT B — [${target.type}] "${target.title}":
${JSON.stringify(target.context).slice(0, 800)}

RULES:
- Only produce this synthesis if the combination reveals something non-obvious or decision-useful. If the two objects are too similar or unrelated, set synthesisType to "low-value".
- Do NOT write generic introductions like "This synthesis combines..." — go straight into the analysis.
- Reference actual data points, numbers, and specifics from both objects.

Return JSON with these fields:
{
  "title": "short synthesis title",
  "summary": "the deep analytical synthesis text",
  "insights": ["insight 1", "insight 2"],
  "synthesisType": "direct-extraction" | "inferred-pattern" | "speculative-synthesis" | "low-value",
  "confidence": 0.0-1.0
}`,
          },
        ],
        'fusion'
      );

      let title = `${source.title} ✦ ${target.title}`;
      let summary = '';
      let insights: string[] = [];

      try {
        const jsonMatch = (result || '').match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.title) title = parsed.title;
          if (parsed.summary) summary = parsed.summary;
          if (parsed.insights && Array.isArray(parsed.insights)) insights = parsed.insights;
        }
      } catch { /* fallback */ }

      // If JSON parsing failed, use the raw text as the summary
      if (!summary && result) {
        summary = result.replace(/```json[\s\S]*?```/g, '').replace(/\{[\s\S]*\}/g, '').trim();
      }
      if (!summary) summary = 'Synthesis could not be generated. Try again.';

      const id = `wo-fusion-${Date.now()}`;
      const fusionData: Record<string, any> = {
        content: summary,
        summary,
        insights: insights.length > 0 ? insights : undefined,
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
  const dragStart = useRef<{ mouseX: number; mouseY: number; objX: number; objY: number } | null>(null);
  const pos = object.freeformPosition ?? { x: 100, y: 100 };

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-freeform-handle]')) return;

      e.preventDefault();
      setDragging(true);
      onDragStart(object.id);
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
        onDragMove(object.id);
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
    [pos, object.id, dispatch, onDragStart, onDragMove, onDragEnd]
  );

  const glowShadow = fusionGlow > 0
    ? `0 0 ${12 + fusionGlow * 24}px ${fusionGlow * 8}px hsl(var(--workspace-accent) / ${fusionGlow * 0.3}), 0 0 ${4 + fusionGlow * 12}px ${fusionGlow * 4}px hsl(var(--workspace-accent) / ${fusionGlow * 0.15})`
    : undefined;

  return (
    <div
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
        transition: dragging ? 'box-shadow 0.15s ease' : 'box-shadow 0.3s ease, transform 0.2s ease',
      }}
      onMouseDown={handleMouseDown}
    >
      {fusionGlow > 0.5 && (
        <div
          className="absolute -inset-1 rounded-2xl pointer-events-none"
          style={{
            border: `1.5px solid hsl(var(--workspace-accent) / ${fusionGlow * 0.4})`,
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
      )}
      <div data-freeform-handle className="absolute inset-x-0 top-0 h-12 cursor-grab active:cursor-grabbing z-20" />
      <WorkspaceObjectWrapper object={object} />
    </div>
  );
}
