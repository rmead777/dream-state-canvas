import { ObjectType, WorkspaceActionType } from './workspace-types';

export type MemoryType = 'correction' | 'preference' | 'entity' | 'pattern' | 'anti-pattern' | 'threshold';
export type MemorySource = 'explicit' | 'inferred' | 'confirmed';
export type MemoryTier = 'prompt' | 'override';

export type WorkspaceStateCondition =
  | 'empty'
  | 'post-upload'
  | 'over-capacity'
  | 'has-alerts'
  | 'has-dataset'
  | 'immersive'
  | 'fusing';

export interface MemoryTrigger {
  onQueryContains?: string[];
  onObjectType?: ObjectType[];
  onAction?: WorkspaceActionType[];
  onWorkspaceState?: WorkspaceStateCondition;
  always?: boolean;
}

export interface SherpaMemory {
  id: string;
  userId: string;
  type: MemoryType;
  trigger: MemoryTrigger;
  content: string;
  reasoning?: string;
  confidence: number;
  source: MemorySource;
  tier: MemoryTier;
  hitCount: number;
  missCount: number;
  lastActivatedAt: string | null;
  createdAt: string;
  tags: string[];
}
