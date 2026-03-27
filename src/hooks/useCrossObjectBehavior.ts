import { useCallback, useMemo } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WorkspaceObject } from '@/lib/workspace-types';

/**
 * Cross-object intelligence hook — relationship-aware interactions.
 * Provides highlight propagation, cascade behaviors, and contextual actions.
 */

export interface CrossObjectBehavior {
  /** IDs of objects related to the given object */
  getRelatedObjects: (objectId: string) => WorkspaceObject[];
  /** Whether an object should dim (a sibling is focused and this one isn't related) */
  shouldDim: (objectId: string) => boolean;
  /** Whether an object should pulse (it's related to the currently hovered/focused object) */
  shouldHighlight: (objectId: string) => boolean;
  /** Dissolve an object and offer to cascade to its children */
  cascadeDissolve: (objectId: string) => string[];
  /** Collapse an object — related objects get dimmed styling */
  cascadeCollapse: (objectId: string) => string[];
  /** Get contextual actions available for an object based on relationships */
  getContextualActions: (objectId: string) => ContextualAction[];
}

export interface ContextualAction {
  id: string;
  label: string;
  query: string;
  icon: string;
}

export function useCrossObjectBehavior(): CrossObjectBehavior {
  const { state } = useWorkspace();
  const { objects, activeContext } = state;

  const getRelatedObjects = useCallback(
    (objectId: string): WorkspaceObject[] => {
      const obj = objects[objectId];
      if (!obj) return [];

      // Direct relationships
      const directRelated = obj.relationships
        .map((id) => objects[id])
        .filter((o): o is WorkspaceObject => !!o && o.status !== 'dissolved');

      // Reverse relationships — objects that reference this one
      const reverseRelated = Object.values(objects).filter(
        (o) =>
          o.id !== objectId &&
          o.status !== 'dissolved' &&
          o.relationships.includes(objectId)
      );

      // Deduplicate
      const seen = new Set<string>();
      const result: WorkspaceObject[] = [];
      for (const o of [...directRelated, ...reverseRelated]) {
        if (!seen.has(o.id)) {
          seen.add(o.id);
          result.push(o);
        }
      }
      return result;
    },
    [objects]
  );

  const shouldDim = useCallback(
    (objectId: string): boolean => {
      const focusedId = activeContext.focusedObjectId;
      if (!focusedId || focusedId === objectId) return false;

      // Check if this object is related to the focused one
      const focusedObj = objects[focusedId];
      if (!focusedObj) return false;

      const isDirectlyRelated =
        focusedObj.relationships.includes(objectId) ||
        (objects[objectId]?.relationships.includes(focusedId) ?? false);

      return !isDirectlyRelated;
    },
    [objects, activeContext.focusedObjectId]
  );

  const shouldHighlight = useCallback(
    (objectId: string): boolean => {
      const focusedId = activeContext.focusedObjectId;
      if (!focusedId || focusedId === objectId) return false;

      const focusedObj = objects[focusedId];
      if (!focusedObj) return false;

      return (
        focusedObj.relationships.includes(objectId) ||
        (objects[objectId]?.relationships.includes(focusedId) ?? false)
      );
    },
    [objects, activeContext.focusedObjectId]
  );

  const cascadeDissolve = useCallback(
    (objectId: string): string[] => {
      const obj = objects[objectId];
      if (!obj) return [];
      // Return IDs of children that could be cascade-dissolved
      return obj.relationships.filter((id) => {
        const child = objects[id];
        return child && child.status !== 'dissolved' && !child.pinned;
      });
    },
    [objects]
  );

  const cascadeCollapse = useCallback(
    (objectId: string): string[] => {
      const obj = objects[objectId];
      if (!obj) return [];
      return obj.relationships.filter((id) => {
        const child = objects[id];
        return child && child.status === 'open' && !child.pinned;
      });
    },
    [objects]
  );

  const getContextualActions = useCallback(
    (objectId: string): ContextualAction[] => {
      const obj = objects[objectId];
      if (!obj) return [];

      const actions: ContextualAction[] = [];

      // Metric objects can offer comparison
      if (obj.type === 'metric') {
        actions.push({
          id: `ctx-compare-${objectId}`,
          label: 'Compare with another fund',
          query: 'compare Alpha and Gamma',
          icon: '⟷',
        });
      }

      // Alert objects can offer "show related metric"
      if (obj.type === 'alert') {
        actions.push({
          id: `ctx-metric-${objectId}`,
          label: 'Show related metric',
          query: 'show me leverage exposure',
          icon: '◈',
        });
      }

      // Comparison objects can offer drill-down
      if (obj.type === 'comparison') {
        actions.push({
          id: `ctx-inspect-${objectId}`,
          label: 'Inspect underlying data',
          query: 'show me the data',
          icon: '⊞',
        });
      }

      // Any object with relationships can offer to show related
      if (obj.relationships.length > 0) {
        const related = obj.relationships
          .map((id) => objects[id])
          .filter((o): o is WorkspaceObject => !!o && o.status !== 'dissolved');
        if (related.some((r) => r.status === 'collapsed')) {
          actions.push({
            id: `ctx-restore-${objectId}`,
            label: 'Restore related objects',
            query: '',
            icon: '↑',
          });
        }
      }

      return actions;
    },
    [objects]
  );

  return {
    getRelatedObjects,
    shouldDim,
    shouldHighlight,
    cascadeDissolve,
    cascadeCollapse,
    getContextualActions,
  };
}
