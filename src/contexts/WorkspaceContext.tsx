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
      return { ...state, objects: newObjects };
    }

    case 'FOCUS_OBJECT':
      return {
        ...state,
        activeContext: { ...state.activeContext, focusedObjectId: action.payload.id },
      };

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
