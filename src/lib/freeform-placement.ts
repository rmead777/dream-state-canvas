import { WorkspaceObject, FreeformPosition } from './workspace-types';

const CARD_WIDTH = 420;
const CARD_HEIGHT = 280;
const SPAWN_OFFSET = 40;

/**
 * Compute where a new object should appear in freeform mode.
 * If it has a related parent, spawn near that parent.
 * Otherwise, cascade from center.
 */
export function computeFreeformPosition(
  objects: Record<string, WorkspaceObject>,
  newObj: { relationships: string[] },
  canvasWidth: number,
  canvasHeight: number,
): FreeformPosition {
  // Find related parent with a freeform position
  const parentId = newObj.relationships.find(
    (id) => objects[id]?.freeformPosition
  );

  if (parentId) {
    const parent = objects[parentId];
    const pos = parent.freeformPosition!;
    // Spawn to the right and slightly below the parent
    return {
      x: pos.x + CARD_WIDTH + SPAWN_OFFSET,
      y: pos.y + SPAWN_OFFSET,
    };
  }

  // Count existing visible objects for cascade offset
  const visible = Object.values(objects).filter(
    (o) => o.status !== 'dissolved' && o.status !== 'collapsed'
  );
  const count = visible.length;

  // Center with cascade
  const centerX = Math.max(40, (canvasWidth - CARD_WIDTH) / 2);
  const centerY = Math.max(40, (canvasHeight - CARD_HEIGHT) / 3);

  return {
    x: centerX + count * SPAWN_OFFSET,
    y: centerY + count * SPAWN_OFFSET,
  };
}
