import React, { createContext, useContext, useReducer, useMemo } from 'react';
import {
  WorkspaceState,
  WorkspaceReducerAction,
  WorkspaceObject,
  SpatialLayout,
} from '@/lib/workspace-types';
import { computeLayoutWithOverflow } from '@/lib/spatial-orchestrator';

const initialState: WorkspaceState = {
  objects: {},
  activeContext: {
    focusedObjectId: null,
    immersiveObjectId: null,
    recentIntents: [],
    sessionStartedAt: Date.now(),
    highlightedEntity: null,
  },
  sherpa: {
    suggestions: [],
    lastResponse: null,
    observations: [],
    isProcessing: false,
    lastAISuggestionsAt: 0,
  },
  spatialLayout: {
    primary: [],
    secondary: [],
    peripheral: [],
  },
  layoutMode: 'auto',
};

/**
 * Compute layout and auto-collapse any overflow objects.
 * Guarantees no open object becomes unreachable (invisible + not in collapsed bar).
 */
function layoutWithOverflowCollapse(objects: Record<string, WorkspaceObject>): {
  objects: Record<string, WorkspaceObject>;
  layout: SpatialLayout;
} {
  const { layout, overflow } = computeLayoutWithOverflow(objects);
  if (overflow.length === 0) return { objects, layout };

  const updated = { ...objects };
  for (const id of overflow) {
    if (updated[id]) {
      updated[id] = { ...updated[id], status: 'collapsed' as const };
    }
  }
  // Re-add collapsed overflow to peripheral
  const peripheral = [...layout.peripheral, ...overflow];
  return { objects: updated, layout: { ...layout, peripheral } };
}

function workspaceReducer(state: WorkspaceState, action: WorkspaceReducerAction): WorkspaceState {
  const now = Date.now();

  switch (action.type) {
    case 'MATERIALIZE_OBJECT': {
      const obj: WorkspaceObject = {
        ...action.payload,
        status: 'materializing',
        createdAt: now,
        lastInteractedAt: now,
      };
      const withNew = { ...state.objects, [obj.id]: obj };
      // Auto-collapse overflow objects so nothing becomes unreachable
      const { objects: newObjects, layout } = layoutWithOverflowCollapse(withNew);
      return {
        ...state,
        objects: newObjects,
        spatialLayout: layout,
        activeContext: { ...state.activeContext, focusedObjectId: obj.id },
      };
    }

    case 'OPEN_OBJECT': {
      const obj = state.objects[action.payload.id];
      if (!obj) return state;
      const updated = { ...obj, status: 'open' as const, lastInteractedAt: now };
      const withUpdate = { ...state.objects, [obj.id]: updated };
      // Opening an object can push over capacity — use overflow collapse
      const { objects: newObjects, layout } = layoutWithOverflowCollapse(withUpdate);
      return { ...state, objects: newObjects, spatialLayout: layout };
    }

    case 'DISSOLVE_OBJECT': {
      const obj = state.objects[action.payload.id];
      if (!obj) return state;
      const updated = { ...obj, status: 'dissolved' as const };
      const newObjects = { ...state.objects, [obj.id]: updated };
      return {
        ...state,
        objects: newObjects,
        spatialLayout: computeLayoutWithOverflow(newObjects).layout,
        activeContext: {
          ...state.activeContext,
          focusedObjectId:
            state.activeContext.focusedObjectId === obj.id ? null : state.activeContext.focusedObjectId,
        },
      };
    }

    case 'COLLAPSE_OBJECT': {
      const obj = state.objects[action.payload.id];
      if (!obj) return state;
      const updated = { ...obj, status: 'collapsed' as const, lastInteractedAt: now };
      const newObjects = { ...state.objects, [obj.id]: updated };
      return { ...state, objects: newObjects, spatialLayout: computeLayoutWithOverflow(newObjects).layout };
    }

    case 'RESTORE_OBJECT': {
      const obj = state.objects[action.payload.id];
      if (!obj) return state;
      const updated = { ...obj, status: 'materializing' as const, lastInteractedAt: now };
      const withUpdate = { ...state.objects, [obj.id]: updated };
      // Restoring can push over capacity — use overflow collapse
      const { objects: newObjects, layout } = layoutWithOverflowCollapse(withUpdate);
      return {
        ...state,
        objects: newObjects,
        spatialLayout: layout,
        activeContext: { ...state.activeContext, focusedObjectId: obj.id },
      };
    }

    case 'PIN_OBJECT': {
      const obj = state.objects[action.payload.id];
      if (!obj) return state;
      const updated = { ...obj, pinned: true, lastInteractedAt: now };
      const newObjects = { ...state.objects, [obj.id]: updated };
      return { ...state, objects: newObjects, spatialLayout: computeLayoutWithOverflow(newObjects).layout };
    }

    case 'UNPIN_OBJECT': {
      const obj = state.objects[action.payload.id];
      if (!obj) return state;
      const updated = { ...obj, pinned: false };
      const newObjects = { ...state.objects, [obj.id]: updated };
      return { ...state, objects: newObjects, spatialLayout: computeLayoutWithOverflow(newObjects).layout };
    }

    case 'FOCUS_OBJECT': {
      const focusId = action.payload.id;
      // Also expand the object if it's collapsed — can push over capacity
      if (focusId && state.objects[focusId] && state.objects[focusId].status === 'collapsed') {
        const withExpanded = { ...state.objects, [focusId]: { ...state.objects[focusId], status: 'open' as const, lastInteractedAt: now } };
        const { objects: focusObjects, layout } = layoutWithOverflowCollapse(withExpanded);
        return {
          ...state,
          objects: focusObjects,
          spatialLayout: layout,
          activeContext: { ...state.activeContext, focusedObjectId: focusId },
        };
      }
      return {
        ...state,
        activeContext: { ...state.activeContext, focusedObjectId: focusId },
      };
    }

    case 'TOUCH_OBJECT': {
      const obj = state.objects[action.payload.id];
      if (!obj) return state;
      return {
        ...state,
        objects: { ...state.objects, [obj.id]: { ...obj, lastInteractedAt: now } },
      };
    }

    case 'REFLOW_LAYOUT':
      return { ...state, spatialLayout: action.payload };

    case 'SET_SHERPA_RESPONSE':
      return { ...state, sherpa: { ...state.sherpa, lastResponse: action.payload } };

    case 'SET_SHERPA_SUGGESTIONS':
      return { ...state, sherpa: { ...state.sherpa, suggestions: action.payload } };

    // AI-generated suggestions — also stamps lastAISuggestionsAt so SherpaContext
    // won't overwrite them with engine-generated defaults for 30 seconds.
    case 'SET_SHERPA_SUGGESTIONS_AI':
      return { ...state, sherpa: { ...state.sherpa, suggestions: action.payload, lastAISuggestionsAt: Date.now() } };

    case 'ADD_SHERPA_OBSERVATION':
      return {
        ...state,
        sherpa: {
          ...state.sherpa,
          observations: [...state.sherpa.observations, action.payload],
        },
      };

    case 'SET_SHERPA_PROCESSING':
      return { ...state, sherpa: { ...state.sherpa, isProcessing: action.payload } };

    case 'ADD_RECENT_INTENT':
      return {
        ...state,
        activeContext: {
          ...state.activeContext,
          recentIntents: [...state.activeContext.recentIntents.slice(-9), action.payload],
        },
      };

    case 'UPDATE_RECENT_INTENT_OUTCOME':
      return {
        ...state,
        activeContext: {
          ...state.activeContext,
          recentIntents: state.activeContext.recentIntents.map((intent) =>
            intent.intentId === action.payload.intentId
              ? { ...intent, ...action.payload.patch }
              : intent
          ),
        },
      };

    case 'REORDER_ZONE': {
      const { zone, ids } = action.payload;
      return {
        ...state,
        spatialLayout: { ...state.spatialLayout, [zone]: ids },
      };
    }

    case 'SET_LAYOUT_MODE':
      return { ...state, layoutMode: action.payload };

    case 'UPDATE_FREEFORM_POSITION': {
      const obj = state.objects[action.payload.id];
      if (!obj) return state;
      return {
        ...state,
        objects: {
          ...state.objects,
          [obj.id]: { ...obj, freeformPosition: action.payload.position },
        },
      };
    }

    case 'UPDATE_OBJECT_CONTEXT': {
      const obj = state.objects[action.payload.id];
      if (!obj) return state;
      return {
        ...state,
        objects: {
          ...state.objects,
          [obj.id]: { ...obj, context: action.payload.context },
        },
      };
    }

    case 'UPDATE_OBJECT': {
      const obj = state.objects[action.payload.id];
      if (!obj) return state;
      return {
        ...state,
        objects: {
          ...state.objects,
          [obj.id]: {
            ...obj,
            title: action.payload.title ?? obj.title,
            context: action.payload.context ?? obj.context,
            lastInteractedAt: now,
          },
        },
      };
    }

    case 'ENTER_IMMERSIVE':
      return {
        ...state,
        activeContext: { ...state.activeContext, immersiveObjectId: action.payload.id },
      };

    case 'EXIT_IMMERSIVE':
      return {
        ...state,
        activeContext: { ...state.activeContext, immersiveObjectId: null },
      };

    case 'CLEAR_SHERPA':
      return {
        ...state,
        sherpa: { ...initialState.sherpa },
      };

    case 'COLLAPSE_ALL_OBJECTS': {
      const newObjects: Record<string, WorkspaceObject> = {};
      for (const [id, obj] of Object.entries(state.objects)) {
        if (obj.status !== 'dissolved') {
          newObjects[id] = { ...obj, status: 'collapsed' as const };
        } else {
          newObjects[id] = obj;
        }
      }
      return {
        ...state,
        objects: newObjects,
        spatialLayout: computeLayoutWithOverflow(newObjects).layout,
        activeContext: { ...state.activeContext, focusedObjectId: null },
      };
    }

    case 'DISSOLVE_ALL_OBJECTS': {
      const newObjects: Record<string, WorkspaceObject> = {};
      for (const [id, obj] of Object.entries(state.objects)) {
        newObjects[id] = { ...obj, status: 'dissolved' as const };
      }
      return {
        ...state,
        objects: newObjects,
        spatialLayout: { primary: [], secondary: [], peripheral: [] },
        activeContext: { ...state.activeContext, focusedObjectId: null, immersiveObjectId: null },
      };
    }

    case 'HIGHLIGHT_ENTITY': {
      const entityName = action.payload.entityName;
      // Toggle off if clicking the same entity again
      const next = state.activeContext.highlightedEntity === entityName ? null : entityName;
      return {
        ...state,
        activeContext: { ...state.activeContext, highlightedEntity: next },
      };
    }

    case 'UPDATE_OBJECT_ENTITY_REFS': {
      const obj = state.objects[action.payload.id];
      if (!obj) return state;
      return {
        ...state,
        objects: {
          ...state.objects,
          [action.payload.id]: { ...obj, entityRefs: action.payload.entityRefs },
        },
      };
    }

    default:
      return state;
  }
}

// Split contexts: dispatch is stable (never changes identity), state changes on every action.
// Components that only dispatch (buttons, forms) won't re-render on state changes.
const WorkspaceStateContext = createContext<WorkspaceState | null>(null);
const WorkspaceDispatchContext = createContext<React.Dispatch<WorkspaceReducerAction> | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(workspaceReducer, initialState);

  return (
    <WorkspaceDispatchContext.Provider value={dispatch}>
      <WorkspaceStateContext.Provider value={state}>
        {children}
      </WorkspaceStateContext.Provider>
    </WorkspaceDispatchContext.Provider>
  );
}

/** Read workspace state + dispatch. Most common usage. */
export function useWorkspace() {
  const state = useContext(WorkspaceStateContext);
  const dispatch = useContext(WorkspaceDispatchContext);
  if (!state || !dispatch) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return useMemo(() => ({ state, dispatch }), [state, dispatch]);
}

/** Read only dispatch — stable identity, won't cause re-renders on state changes. */
export function useWorkspaceDispatch() {
  const dispatch = useContext(WorkspaceDispatchContext);
  if (!dispatch) throw new Error('useWorkspaceDispatch must be used within WorkspaceProvider');
  return dispatch;
}
