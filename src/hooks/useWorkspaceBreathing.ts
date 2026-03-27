import { useEffect, useRef, useCallback } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';

const MAX_OPEN = 3;
const INACTIVITY_MS = 45000; // 45 seconds for demo (would be minutes in production)

/**
 * Workspace breathing — the system actively manages surface area.
 * Auto-collapses low-priority inactive objects when density exceeds threshold.
 * The workspace defaults back toward calm when tasks are complete.
 */
export function useWorkspaceBreathing() {
  const { state, dispatch } = useWorkspace();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const breathe = useCallback(() => {
    const now = Date.now();
    const openObjects = Object.values(state.objects).filter(
      (o) => o.status === 'open' || o.status === 'materializing'
    );

    if (openObjects.length <= MAX_OPEN) return;

    // Sort by priority: pinned first, then recently interacted
    const sorted = [...openObjects].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.lastInteractedAt - a.lastInteractedAt;
    });

    // Auto-collapse objects beyond the threshold that are inactive
    const excess = sorted.slice(MAX_OPEN);
    for (const obj of excess) {
      if (!obj.pinned && now - obj.lastInteractedAt > INACTIVITY_MS) {
        dispatch({ type: 'COLLAPSE_OBJECT', payload: { id: obj.id } });
      }
    }
  }, [state.objects, dispatch]);

  useEffect(() => {
    timerRef.current = setInterval(breathe, 10000); // check every 10s
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [breathe]);

  // Also breathe immediately when object count changes
  const openCount = Object.values(state.objects).filter(
    (o) => o.status === 'open' || o.status === 'materializing'
  ).length;

  useEffect(() => {
    if (openCount > MAX_OPEN) {
      // Delayed breathing — give the user a moment
      const timer = setTimeout(breathe, 8000);
      return () => clearTimeout(timer);
    }
  }, [openCount, breathe]);

  return { openCount, maxOpen: MAX_OPEN, isOverCapacity: openCount > MAX_OPEN };
}
