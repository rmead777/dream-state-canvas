import { SpatialLayout, WorkspaceObject, SpatialZone } from './workspace-types';

const MAX_PRIMARY = 2;
const MAX_SECONDARY = 2;
const MAX_VISIBLE = 4; // Anti-drift: never more than 4 full objects

export interface ComputeLayoutResult {
  layout: SpatialLayout;
  /** Object IDs that overflow beyond MAX_VISIBLE — caller should collapse these */
  overflow: string[];
}

/**
 * Pure function: given current objects, compute optimal spatial layout.
 * Enforces density ceiling and zone rules.
 * Returns overflow IDs so the reducer can auto-collapse them —
 * no open object should ever become unreachable.
 */
export function computeLayout(objects: Record<string, WorkspaceObject>): SpatialLayout {
  const result = computeLayoutWithOverflow(objects);
  return result.layout;
}

/**
 * Full layout computation with overflow detection.
 * Use this when you need to know which objects overflowed.
 */
export function computeLayoutWithOverflow(objects: Record<string, WorkspaceObject>): ComputeLayoutResult {
  const open = Object.values(objects).filter(
    (o) => o.status === 'open' || o.status === 'materializing'
  );
  const collapsed = Object.values(objects).filter((o) => o.status === 'collapsed');

  // Sort by: pinned first, then most recently interacted
  const sorted = [...open].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.lastInteractedAt - a.lastInteractedAt;
  });

  const primary: string[] = [];
  const secondary: string[] = [];
  const overflow: string[] = [];

  for (const obj of sorted) {
    if (primary.length < MAX_PRIMARY) {
      primary.push(obj.id);
    } else if (secondary.length < MAX_SECONDARY) {
      secondary.push(obj.id);
    } else {
      overflow.push(obj.id);
    }
  }

  const peripheral = collapsed.map((o) => o.id);

  return { layout: { primary, secondary, peripheral }, overflow };
}

/**
 * Determine where a new object should materialize.
 */
export function placeNewObject(
  currentLayout: SpatialLayout,
  _newObjectId: string
): SpatialZone {
  const totalVisible = currentLayout.primary.length + currentLayout.secondary.length;

  if (currentLayout.primary.length < MAX_PRIMARY) return 'primary';
  if (totalVisible < MAX_VISIBLE) return 'secondary';

  // Would exceed ceiling — still place in primary, orchestrator will shift others
  return 'primary';
}

/**
 * When a new object is placed in primary and it's full,
 * determine which existing object should shift to secondary.
 */
export function getObjectToShift(
  objects: Record<string, WorkspaceObject>,
  currentPrimary: string[]
): string | null {
  if (currentPrimary.length < MAX_PRIMARY) return null;

  // Shift the oldest non-pinned object
  const shiftable = currentPrimary
    .map((id) => objects[id])
    .filter((o) => o && !o.pinned)
    .sort((a, b) => a.lastInteractedAt - b.lastInteractedAt);

  return shiftable[0]?.id ?? null;
}
