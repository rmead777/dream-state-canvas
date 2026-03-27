import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { WorkspaceObject as WO } from '@/lib/workspace-types';
import { WorkspaceObjectWrapper } from './WorkspaceObject';

export function SortableObject({ object }: { object: WO }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: object.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <WorkspaceObjectWrapper object={object} dragListeners={listeners} />
    </div>
  );
}
