import { useMemo } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export interface AmbientHintData {
  objectId: string;
  hint: string;
  acceptLabel?: string;
  action?: 'pin' | 'monitor' | 'collapse';
}

/**
 * Generates ambient Sherpa hints that appear near specific objects.
 * These are contextual, not conversational.
 */
export function useAmbientSherpa(): AmbientHintData[] {
  const { state } = useWorkspace();
  const { objects } = state;

  return useMemo(() => {
    const hints: AmbientHintData[] = [];
    const now = Date.now();
    const objectList = Object.values(objects).filter((o) => o.status !== 'dissolved');

    for (const obj of objectList) {
      // Suggest pinning frequently accessed objects
      if (
        !obj.pinned &&
        obj.status === 'open' &&
        now - obj.createdAt > 30000 &&
        obj.lastInteractedAt > obj.createdAt + 10000
      ) {
        hints.push({
          objectId: obj.id,
          hint: 'You keep coming back to this. Pin it?',
          acceptLabel: 'Pin',
          action: 'pin',
        });
      }

      // Suggest monitoring for metrics that are trending
      if (
        obj.type === 'metric' &&
        obj.context?.trend === 'increasing' &&
        obj.status === 'open'
      ) {
        hints.push({
          objectId: obj.id,
          hint: 'This metric is trending up. Create a monitor?',
          acceptLabel: 'Monitor',
          action: 'monitor',
        });
      }

      // Suggest collapsing stale objects
      if (
        obj.status === 'open' &&
        !obj.pinned &&
        now - obj.lastInteractedAt > 60000
      ) {
        hints.push({
          objectId: obj.id,
          hint: 'This has not been touched recently. Collapse to reduce noise?',
          acceptLabel: 'Collapse',
          action: 'collapse',
        });
      }
    }

    // Only show max 2 ambient hints at a time to avoid noise
    return hints.slice(0, 2);
  }, [objects]);
}
