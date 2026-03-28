import React, { createContext, useContext, useReducer, useCallback } from 'react';
import {
  WorkspaceState,
  WorkspaceReducerAction,
  WorkspaceObject,
  SpatialLayout,
} from '@/lib/workspace-types';
import { computeLayout } from '@/lib/spatial-orchestrator';

const initialState: WorkspaceState = {
  objects: {},
  activeContext: {
    focusedObjectId: null,
    immersiveObjectId: null,
    recentIntents: [],
    sessionStartedAt: Date.now(),
  },
  sherpa: {
    suggestions: [],
    lastResponse: null,
    observations: [],
    isProcessing: false,
  },
  spatialLayout: {
    primary: [],
    secondary: [],
    peripheral: [],
  },
  layoutMode: 'auto',
};

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
      const newObjects = { ...state.objects, [obj.id]: obj };
      const layout = computeLayout(newObjects);
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
      const newObjects = { ...state.objects, [obj.id]: updated };
      return { ...state, objects: newObjects, spatialLayout: computeLayout(newObjects) };
    }

    case 'DISSOLVE_OBJECT': {
      const obj = state.objects[action.payload.id];
      if (!obj) return state;
      const updated = { ...obj, status: 'dissolved' as const };
      const newObjects = { ...state.objects, [obj.id]: updated };
      const layout = computeLayout(newObjects);
      return {
        ...state,
        objects: newObjects,
        spatialLayout: layout,
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
      return { ...state, objects: newObjects, spatialLayout: computeLayout(newObjects) };
    }

    case 'RESTORE_OBJECT': {
      const obj = state.objects[action.payload.id];
      if (!obj) return state;
      const updated = { ...obj, status: 'materializing' as const, lastInteractedAt: now };
      const newObjects = { ...state.objects, [obj.id]: updated };
      return {
        ...state,
        objects: newObjects,
        spatialLayout: computeLayout(newObjects),
        activeContext: { ...state.activeContext, focusedObjectId: obj.id },
      };
    }

    case 'PIN_OBJECT': {
      const obj = state.objects[action.payload.id];
      if (!obj) return state;
      const updated = { ...obj, pinned: true, lastInteractedAt: now };
      const newObjects = { ...state.objects, [obj.id]: updated };
      return { ...state, objects: newObjects, spatialLayout: computeLayout(newObjects) };
    }

    case 'UNPIN_OBJECT': {
      const obj = state.objects[action.payload.id];
      if (!obj) return state;
      const updated = { ...obj, pinned: false };
      const newObjects = { ...state.objects, [obj.id]: updated };
      return { ...state, objects: newObjects, spatialLayout: computeLayout(newObjects) };
    }

    case 'FOCUS_OBJECT': {
      const focusId = action.payload.id;
      // Also expand the object if it's collapsed
      let focusObjects = state.objects;
      if (focusId && state.objects[focusId] && state.objects[focusId].status === 'collapsed') {
        focusObjects = { ...state.objects, [focusId]: { ...state.objects[focusId], status: 'open' as const, lastInteractedAt: now } };
      }
      return {
        ...state,
        objects: focusObjects,
        spatialLayout: focusObjects !== state.objects ? computeLayout(focusObjects) : state.spatialLayout,
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
        spatialLayout: computeLayout(newObjects),
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

    default:
      return state;
  }
}

interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: React.Dispatch<WorkspaceReducerAction>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(workspaceReducer, initialState);

  return (
    <WorkspaceContext.Provider value={{ state, dispatch }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
