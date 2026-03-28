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

  const dragHandleProps = { ...attributes, ...listeners };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isFusionTarget
        ? 'rounded-2xl ring-2 ring-workspace-accent/40 shadow-[0_0_24px_hsl(var(--workspace-accent)/0.15)] transition-shadow duration-300 focus-within:shadow-[0_18px_40px_rgba(99,102,241,0.12)]'
        : 'transition-shadow duration-300 focus-within:shadow-[0_18px_40px_rgba(99,102,241,0.12)]'
      }
    >
      <WorkspaceObjectWrapper object={object} dragHandleProps={dragHandleProps} />
    </div>
  );
}
