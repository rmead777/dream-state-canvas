import { useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { SortableObject } from './SortableObject';
import { RelationshipConnector } from './RelationshipConnector';

export function PanelCanvas() {
  const { state, dispatch } = useWorkspace();
  const { spatialLayout, objects } = state;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const primaryObjects = spatialLayout.primary
    .map((id) => objects[id])
    .filter((o) => o && o.status !== 'dissolved');

  const secondaryObjects = spatialLayout.secondary
    .map((id) => objects[id])
    .filter((o) => o && o.status !== 'dissolved');

  const hasObjects = primaryObjects.length > 0 || secondaryObjects.length > 0;

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeId = String(active.id);
      const overId = String(over.id);

      // Determine which zone the active item belongs to
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
    [spatialLayout, dispatch]
  );

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 lg:p-10">
      {!hasObjects ? (
        <div className="flex h-full items-center justify-center">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-6 h-px w-16 bg-workspace-border" />
            <p className="text-sm text-workspace-text-secondary/50 leading-relaxed">
              Your workspace is clear. Ask the Sherpa to surface what matters, or explore a suggestion.
            </p>
          </div>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="mx-auto max-w-4xl space-y-4">
            {/* Primary zone */}
            {primaryObjects.length > 0 && (
              <SortableContext items={primaryObjects.map((o) => o.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-5">
                  {primaryObjects.map((obj) => (
                    <SortableObject key={obj.id} object={obj} />
                  ))}
                </div>
              </SortableContext>
            )}

            <RelationshipConnector />

            {/* Secondary zone */}
            {secondaryObjects.length > 0 && (
              <SortableContext items={secondaryObjects.map((o) => o.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    {secondaryObjects.map((obj) => (
                      <SortableObject key={obj.id} object={obj} />
                    ))}
                  </div>
                </div>
              </SortableContext>
            )}
          </div>
        </DndContext>
      )}
    </div>
  );
}
