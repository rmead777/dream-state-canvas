import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { WorkspaceObject as WO } from '@/lib/workspace-types';
import { WorkspaceObjectWrapper } from './WorkspaceObject';

export function SortableObject({ object, isFusionTarget }: { object: WO; isFusionTarget?: boolean }) {
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
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={isFusionTarget
        ? 'rounded-2xl ring-2 ring-workspace-accent/40 shadow-[0_0_24px_hsl(var(--workspace-accent)/0.15)] transition-shadow duration-300'
        : 'transition-shadow duration-300'
      }
    >
      <WorkspaceObjectWrapper object={object} dragListeners={listeners} />
    </div>
  );
}
