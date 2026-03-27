import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useMemo } from 'react';

/**
 * RelationshipConnector — renders subtle visual links between related objects.
 * Uses shared accent coloring rather than literal lines (cleaner, more scalable).
 * This component renders relationship indicators in the workspace.
 */

interface RelationshipGroup {
  sourceId: string;
  sourceTitle: string;
  targetIds: string[];
  targetTitles: string[];
}

export function RelationshipConnector() {
  const { state } = useWorkspace();
  const { objects, activeContext } = state;

  const relationshipGroups = useMemo(() => {
    const groups: RelationshipGroup[] = [];
    const seen = new Set<string>();

    for (const obj of Object.values(objects)) {
      if (obj.status === 'dissolved' || obj.relationships.length === 0) continue;

      const activeRelated = obj.relationships.filter((id) => {
        const target = objects[id];
        return target && target.status !== 'dissolved' && target.status !== 'collapsed';
      });

      if (activeRelated.length === 0) continue;

      // Deduplicate bidirectional relationships
      const key = [obj.id, ...activeRelated].sort().join(':');
      if (seen.has(key)) continue;
      seen.add(key);

      groups.push({
        sourceId: obj.id,
        sourceTitle: obj.title,
        targetIds: activeRelated,
        targetTitles: activeRelated.map((id) => objects[id]?.title ?? ''),
      });
    }

    return groups;
  }, [objects]);

  if (relationshipGroups.length === 0) return null;

  const focusedId = activeContext.focusedObjectId;

  return (
    <div className="mx-auto max-w-4xl px-6 lg:px-10">
      {relationshipGroups.map((group) => {
        const isActive =
          focusedId === group.sourceId || group.targetIds.includes(focusedId ?? '');

        return (
          <div
            key={`${group.sourceId}-${group.targetIds.join(',')}`}
            className={`
              flex items-center gap-2 py-1.5 transition-all duration-300
              ${isActive ? 'opacity-100' : 'opacity-40'}
            `}
          >
            <div
              className={`
                h-px flex-1 transition-colors duration-300
                ${isActive ? 'bg-workspace-accent/30' : 'bg-workspace-border/50'}
              `}
            />
            <span
              className={`
                text-[9px] uppercase tracking-widest transition-colors duration-300
                ${isActive ? 'text-workspace-accent/60' : 'text-workspace-text-secondary/30'}
              `}
            >
              {group.sourceTitle} ⟷ {group.targetTitles.join(', ')}
            </span>
            <div
              className={`
                h-px flex-1 transition-colors duration-300
                ${isActive ? 'bg-workspace-accent/30' : 'bg-workspace-border/50'}
              `}
            />
          </div>
        );
      })}
    </div>
  );
}
