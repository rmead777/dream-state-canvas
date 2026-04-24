/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ManifestationPhase } from './manifestation-types';

// ─── Workspace Object Model ───────────────────────────────────────────────────

export type ObjectType =
  | 'metric' | 'comparison' | 'alert' | 'inspector' | 'brief'
  | 'timeline' | 'monitor' | 'document' | 'document-viewer' | 'dataset' | 'analysis'
  | 'action-queue' | 'vendor-dossier' | 'cash-planner'
  | 'escalation-tracker' | 'outreach-tracker' | 'production-risk'
  | 'email-draft' | 'simulation'
  | 'dataset-edit-preview' | 'memory-cleanup-preview';

export type ObjectStatus = 'materializing' | 'open' | 'collapsed' | 'dissolved';

export type SpatialZone = 'primary' | 'secondary' | 'peripheral';

export type IntentOriginType = 'user-query' | 'sherpa-suggestion' | 'cross-object' | 'system';

export interface IntentOrigin {
  type: IntentOriginType;
  intentId?: string;
  query?: string;
  sourceObjectId?: string;
  timestamp?: number;
  response?: string;
  outcomeSummary?: string;
  resultingFocusObjectId?: string | null;
  affectedObjectIds?: string[];
  createdObjectIds?: string[];
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

export interface EntityRef {
  entityName: string;
  entityType: 'vendor' | 'person' | 'date' | 'other';
}

export interface WorkspaceObject {
  id: string;
  type: ObjectType;
  title: string;
  status: ObjectStatus;
  pinned: boolean;
  origin: IntentOrigin;
  relationships: string[];
  /** Entity references extracted from this card's content — used for smart card linking */
  entityRefs?: EntityRef[];
  context: Record<string, any>;
  position: SpatialPosition;
  freeformPosition?: FreeformPosition;
  createdAt: number;
  lastInteractedAt: number;
  // ─── Manifestation (optional; only populated during the materialize sequence) ─────────
  /**
   * Sub-phase within `status: 'materializing'`. When present, drives the
   * choreographed manifestation (scaffold → resolving → hydrating → settled).
   * When absent, the legacy single-step `materialize` CSS animation applies.
   */
  manifestationPhase?: ManifestationPhase;
  /**
   * Cards this card was derived from. Used by the particle layer to draw
   * data-lineage flows from source positions to the new card's spawn point.
   * Populated at scaffold time from agent shadow state.
   */
  sourceObjectIds?: string[];
}

// ─── Intent Engine Types ──────────────────────────────────────────────────────

export type WorkspaceActionType = 'create' | 'focus' | 'dissolve' | 'respond' | 'fuse' | 'refine-rules' | 'update' | 'immersive' | 'open-source-document';

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

export interface FuseAction {
  type: 'fuse';
  objectIdA: string;
  objectIdB: string;
}

export interface RefineRulesAction {
  type: 'refine-rules';
  feedback: string;
}

export interface UpdateAction {
  type: 'update';
  objectId: string;
  instruction: string;
}

export interface ImmersiveAction {
  type: 'immersive';
  objectId: string;
}

export interface OpenSourceDocumentAction {
  type: 'open-source-document';
  documentId: string;
}

export type WorkspaceAction = CreateAction | FocusAction | DissolveAction | RespondAction | FuseAction | RefineRulesAction | UpdateAction | ImmersiveAction | OpenSourceDocumentAction;

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
  /** Current tool/step status during processing (e.g. "Querying dataset..."). Separate from lastResponse. */
  processingStatus: string | null;
  observations: string[];
  /** Observation strings the user has dismissed — prevents re-generation */
  dismissedObservations: string[];
  isProcessing: boolean;
  /** Timestamp of last AI-dispatched nextMoves — SherpaContext won't overwrite for 30s after this */
  lastAISuggestionsAt: number;
}

// ─── Workspace State ──────────────────────────────────────────────────────────

export interface ActiveContext {
  focusedObjectId: string | null;
  immersiveObjectId: string | null;
  recentIntents: IntentOrigin[];
  sessionStartedAt: number;
  /** Entity name currently highlighted — cards containing this entity get a visual ring */
  highlightedEntity: string | null;
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
  layoutMode: LayoutMode;
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
  | { type: 'SET_SHERPA_SUGGESTIONS_AI'; payload: Suggestion[] }
  | { type: 'ADD_SHERPA_OBSERVATION'; payload: string }
  | { type: 'SET_SHERPA_PROCESSING'; payload: boolean }
  | { type: 'SET_SHERPA_STATUS'; payload: string | null }
  | { type: 'ADD_RECENT_INTENT'; payload: IntentOrigin }
  | { type: 'UPDATE_RECENT_INTENT_OUTCOME'; payload: { intentId: string; patch: Partial<IntentOrigin> } }
  | { type: 'REORDER_ZONE'; payload: { zone: 'primary' | 'secondary'; ids: string[] } }
  | { type: 'SET_LAYOUT_MODE'; payload: LayoutMode }
  | { type: 'UPDATE_FREEFORM_POSITION'; payload: { id: string; position: FreeformPosition } }
  | { type: 'UPDATE_OBJECT_CONTEXT'; payload: { id: string; context: Record<string, any> } }
  | { type: 'UPDATE_OBJECT'; payload: { id: string; title?: string; context?: Record<string, any> } }
  | { type: 'ENTER_IMMERSIVE'; payload: { id: string } }
  | { type: 'EXIT_IMMERSIVE' }
  | { type: 'DISMISS_SHERPA_OBSERVATION'; payload: string }
  | { type: 'CLEAR_SHERPA' }
  | { type: 'COLLAPSE_ALL_OBJECTS' }
  | { type: 'DISSOLVE_ALL_OBJECTS' }
  | { type: 'HIGHLIGHT_ENTITY'; payload: { entityName: string | null } }
  | { type: 'UPDATE_OBJECT_ENTITY_REFS'; payload: { id: string; entityRefs: EntityRef[] } }
  // ─── Manifestation actions ─────────────────────────────────────────────────
  /**
   * Spawn a provisional scaffold card during the agent loop — before the real
   * MATERIALIZE_OBJECT has fired. Creates a WorkspaceObject with:
   *   - status: 'materializing'
   *   - manifestationPhase: 'scaffold'
   *   - minimal context (empty sections)
   * When the agent loop completes and handleCreate runs, if an object with
   * the same id already exists (the scaffold), it's upgraded via UPDATE_OBJECT
   * + ADVANCE_MANIFESTATION_PHASE rather than re-materialized.
   */
  | {
      type: 'MATERIALIZE_SCAFFOLD';
      payload: {
        id: string;
        objectType: ObjectType;
        title: string;
        sourceObjectIds: string[];
        origin: IntentOrigin;
      };
    }
  | {
      type: 'ADVANCE_MANIFESTATION_PHASE';
      payload: { id: string; phase: ManifestationPhase };
    };
