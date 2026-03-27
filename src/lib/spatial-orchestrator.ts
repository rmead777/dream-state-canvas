import { SpatialLayout, WorkspaceObject, SpatialZone } from './workspace-types';

const MAX_PRIMARY = 2;
const MAX_SECONDARY = 2;
const MAX_VISIBLE = 4; // Anti-drift: never more than 4 full objects

/**
 * Pure function: given current objects, compute optimal spatial layout.
 * Enforces density ceiling and zone rules.
 */
export function computeLayout(objects: Record<string, WorkspaceObject>): SpatialLayout {
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

  for (const obj of sorted) {
    if (primary.length < MAX_PRIMARY) {
      primary.push(obj.id);
    } else if (secondary.length < MAX_SECONDARY) {
      secondary.push(obj.id);
    }
    // If we exceed MAX_VISIBLE, remaining stay in their current position
    // but the UI will apply receded styling
  }

  const peripheral = collapsed.map((o) => o.id);

  return { primary, secondary, peripheral };
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
