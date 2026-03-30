import { useCallback, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { SortableObject } from './SortableObject';
import { RelationshipConnector } from './RelationshipConnector';
import { FreeformCanvas } from './FreeformCanvas';
import { FusionZone } from './FusionZone';
import { canFuse } from '@/lib/fusion-rules';
import { useFusion } from '@/hooks/useFusion';

export function PanelCanvas() {
  const { state, dispatch } = useWorkspace();
  const { spatialLayout, objects, layoutMode } = state;
  const [fusionTarget, setFusionTarget] = useState<{ sourceId: string; targetId: string } | null>(null);
  const [fusionProcessing, setFusionProcessing] = useState(false);
  const [fusionHoverId, setFusionHoverId] = useState<string | null>(null);
  const [_activeDragId, setActiveDragId] = useState<string | null>(null);

  const { handleFuse } = useFusion({
    objects,
    fusionTarget,
    layoutMode,
    onComplete: () => { setFusionProcessing(false); setFusionTarget(null); },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const primaryObjects = spatialLayout.primary
    .map((id) => objects[id])
    .filter((o) => o && o.status !== 'dissolved');

  const secondaryObjects = spatialLayout.secondary
    .map((id) => objects[id])
    .filter((o) => o && o.status !== 'dissolved');

  const hasObjects = primaryObjects.length > 0 || secondaryObjects.length > 0;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) {
        setFusionHoverId(null);
        return;
      }
      const activeObj = objects[String(active.id)];
      const overObj = objects[String(over.id)];
      if (activeObj && overObj && canFuse(activeObj.type, overObj.type)) {
        setFusionHoverId(String(over.id));
      } else {
        setFusionHoverId(null);
      }
    },
    [objects]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveDragId(null);
      setFusionHoverId(null);

      if (!over || active.id === over.id) return;

      const activeId = String(active.id);
      const overId = String(over.id);
      const activeObj = objects[activeId];
      const overObj = objects[overId];

      // Check for fusion — if compatible types and significant vertical overlap
      if (activeObj && overObj && canFuse(activeObj.type, overObj.type)) {
        // Trigger fusion confirmation
        setFusionTarget({ sourceId: activeId, targetId: overId });
        return;
      }

      // Normal reorder
      for (const zone of ['primary', 'secondary'] as const) {
        const ids = spatialLayout[zone];
        const oldIdx = ids.indexOf(activeId);
        const newIdx = ids.indexOf(overId);
        if (oldIdx !== -1 && newIdx !== -1) {
          dispatch({
            type: 'REORDER_ZONE',
            payload: { zone, ids: arrayMove(ids, oldIdx, newIdx) },
          });
          return;
        }
      }
    },
    [spatialLayout, objects, dispatch]
  );

  const handleCancelFusion = useCallback(() => {
    setFusionTarget(null);
  }, []);

  if (layoutMode === 'freeform') {
    return <FreeformCanvas />;
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 lg:p-10">
        {!hasObjects ? (
          <div className="flex h-full items-center justify-center">
            <div className="workspace-card-surface max-w-xl rounded-[30px] border border-workspace-border/45 px-8 py-8 text-center shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
              <span className="workspace-pill inline-flex rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/75">
                Workspace idle
              </span>
              <div className="mx-auto mt-4 mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-workspace-accent/12 bg-white/75 text-xl text-workspace-accent shadow-[0_16px_38px_rgba(99,102,241,0.12)] backdrop-blur-sm">✦</div>
              <div className="mx-auto mb-5 h-px w-16 bg-workspace-border" />
              <p className="text-sm text-workspace-text leading-relaxed">
                Nothing is materialized yet. Ask Sherpa for the one thing you need first, then let the workspace build outward from there.
              </p>
              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                {[
                  { label: 'Ctrl/⌘ K · Command palette', action: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true })) },
                  { label: 'Ask Sherpa for a brief', action: () => document.dispatchEvent(new CustomEvent('sherpa-query', { detail: 'give me a brief' })) },
                  { label: 'Surface top risks first', action: () => document.dispatchEvent(new CustomEvent('sherpa-query', { detail: 'show me urgent risks' })) },
                ].map((hint) => (
                  <button
                    key={hint.label}
                    onClick={hint.action}
                    className="workspace-pill workspace-focus-ring rounded-full px-3 py-2 text-[11px] text-workspace-text-secondary transition-all hover:text-workspace-accent hover:border-workspace-accent/20 cursor-pointer"
                  >
                    {hint.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <div className="mx-auto max-w-4xl space-y-4">
              {primaryObjects.length > 0 && (
                <SortableContext items={primaryObjects.map((o) => o.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-5">
                    <div className="flex items-center justify-between px-1">
                      <span className="workspace-section-label">Primary focus</span>
                      <span className="text-[11px] text-workspace-text-secondary/45 tabular-nums">
                        {primaryObjects.length} live views
                      </span>
                    </div>
                    {primaryObjects.map((obj) => (
                      <SortableObject
                        key={obj.id}
                        object={obj}
                        isFusionTarget={fusionHoverId === obj.id}
                      />
                    ))}
                  </div>
                </SortableContext>
              )}

              <RelationshipConnector />

              {secondaryObjects.length > 0 && (
                <SortableContext items={secondaryObjects.map((o) => o.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-5">
                    <div className="flex items-center justify-between px-1 pt-2">
                      <span className="workspace-section-label">Supporting views</span>
                      <span className="text-[11px] text-workspace-text-secondary/45 tabular-nums">
                        {secondaryObjects.length} contextual panels
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                      {secondaryObjects.map((obj) => (
                        <SortableObject
                          key={obj.id}
                          object={obj}
                          isFusionTarget={fusionHoverId === obj.id}
                        />
                      ))}
                    </div>
                  </div>
                </SortableContext>
              )}
            </div>
          </DndContext>
        )}

        {/* Fusion confirmation overlay */}
        {fusionTarget && (
          <FusionZone
            sourceTitle={objects[fusionTarget.sourceId]?.title || ''}
            targetTitle={objects[fusionTarget.targetId]?.title || ''}
            isProcessing={fusionProcessing}
            onFuse={() => { setFusionProcessing(true); handleFuse(); }}
            onCancel={handleCancelFusion}
          />
        )}
      </div>
    </>
  );
}
