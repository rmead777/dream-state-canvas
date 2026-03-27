// ─── Workspace Object Model ───────────────────────────────────────────────────

export type ObjectType = 'metric' | 'comparison' | 'alert' | 'inspector' | 'brief' | 'timeline' | 'monitor';

export type ObjectStatus = 'materializing' | 'open' | 'collapsed' | 'dissolved';

export type SpatialZone = 'primary' | 'secondary' | 'peripheral';

export type IntentOriginType = 'user-query' | 'sherpa-suggestion' | 'cross-object' | 'system';

export interface IntentOrigin {
  type: IntentOriginType;
  query?: string;
  sourceObjectId?: string;
}

export interface SpatialPosition {
  zone: SpatialZone;
  order: number;
}

export interface FreeformPosition {
  x: number;
  y: number;
}

export type LayoutMode = 'auto' | 'freeform';

export interface WorkspaceObject {
  id: string;
  type: ObjectType;
  title: string;
  status: ObjectStatus;
  pinned: boolean;
  origin: IntentOrigin;
  relationships: string[];
  context: Record<string, any>;
  position: SpatialPosition;
  createdAt: number;
  lastInteractedAt: number;
}

// ─── Intent Engine Types ──────────────────────────────────────────────────────

export type WorkspaceActionType = 'create' | 'focus' | 'dissolve' | 'respond';

export interface CreateAction {
  type: 'create';
  objectType: ObjectType;
  title: string;
  data: Record<string, any>;
  relatedTo?: string[];
}

export interface FocusAction {
  type: 'focus';
  objectId: string;
}

export interface DissolveAction {
  type: 'dissolve';
  objectId: string;
}

export interface RespondAction {
  type: 'respond';
  message: string;
}

export type WorkspaceAction = CreateAction | FocusAction | DissolveAction | RespondAction;

export interface IntentResult {
  actions: WorkspaceAction[];
}

// ─── Sherpa Types ─────────────────────────────────────────────────────────────

export interface Suggestion {
  id: string;
  label: string;
  query: string;
  priority: number;
}

export interface SherpaState {
  suggestions: Suggestion[];
  lastResponse: string | null;
  observations: string[];
  isProcessing: boolean;
}

// ─── Workspace State ──────────────────────────────────────────────────────────

export interface ActiveContext {
  focusedObjectId: string | null;
  recentIntents: IntentOrigin[];
  sessionStartedAt: number;
}

export interface SpatialLayout {
  primary: string[];
  secondary: string[];
  peripheral: string[];
}

export interface WorkspaceState {
  objects: Record<string, WorkspaceObject>;
  activeContext: ActiveContext;
  sherpa: SherpaState;
  spatialLayout: SpatialLayout;
}

// ─── Reducer Actions ──────────────────────────────────────────────────────────

export type WorkspaceReducerAction =
  | { type: 'MATERIALIZE_OBJECT'; payload: Omit<WorkspaceObject, 'status' | 'createdAt' | 'lastInteractedAt'> }
  | { type: 'OPEN_OBJECT'; payload: { id: string } }
  | { type: 'DISSOLVE_OBJECT'; payload: { id: string } }
  | { type: 'COLLAPSE_OBJECT'; payload: { id: string } }
  | { type: 'RESTORE_OBJECT'; payload: { id: string } }
  | { type: 'PIN_OBJECT'; payload: { id: string } }
  | { type: 'UNPIN_OBJECT'; payload: { id: string } }
  | { type: 'FOCUS_OBJECT'; payload: { id: string | null } }
  | { type: 'TOUCH_OBJECT'; payload: { id: string } }
  | { type: 'REFLOW_LAYOUT'; payload: SpatialLayout }
  | { type: 'SET_SHERPA_RESPONSE'; payload: string }
  | { type: 'SET_SHERPA_SUGGESTIONS'; payload: Suggestion[] }
  | { type: 'ADD_SHERPA_OBSERVATION'; payload: string }
  | { type: 'SET_SHERPA_PROCESSING'; payload: boolean }
  | { type: 'ADD_RECENT_INTENT'; payload: IntentOrigin }
  | { type: 'REORDER_ZONE'; payload: { zone: 'primary' | 'secondary'; ids: string[] } };
