import { z } from 'zod';
import { CardSection, DataQuerySchema } from './card-schema';

/**
 * Zod schemas for validating LLM intent output.
 * Prevents malformed AI responses from creating invalid object types
 * or dispatching nonsensical actions.
 */

export const ObjectTypeSchema = z.enum([
  'metric', 'comparison', 'alert', 'inspector', 'brief',
  'timeline', 'monitor', 'document', 'dataset', 'analysis',
  'action-queue', 'vendor-dossier', 'cash-planner',
  'escalation-tracker', 'outreach-tracker', 'production-risk',
]);

export const CreateActionSchema = z.object({
  type: z.literal('create'),
  objectType: ObjectTypeSchema,
  title: z.string().min(1).default('Untitled'),
  relatedTo: z.array(z.string()).optional(),
  sections: z.array(CardSection).optional(),
  dataQuery: DataQuerySchema.optional(),
});

export const FocusActionSchema = z.object({
  type: z.literal('focus'),
  objectId: z.string().min(1),
});

export const DissolveActionSchema = z.object({
  type: z.literal('dissolve'),
  objectId: z.string().min(1),
});

const SectionOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), section: CardSection }),
  z.object({ op: z.literal('remove'), sectionIndex: z.number() }),
  z.object({ op: z.literal('replace'), sectionIndex: z.number(), section: CardSection }),
  z.object({ op: z.literal('requery'), dataQuery: DataQuerySchema }),
]);

export const UpdateActionSchema = z.object({
  type: z.literal('update'),
  objectId: z.string().min(1),
  instruction: z.string().min(1),
  sectionOperations: z.array(SectionOperationSchema).optional(),
});

export const FuseActionSchema = z.object({
  type: z.literal('fuse'),
  objectIdA: z.string().min(1),
  objectIdB: z.string().min(1),
});

export const RefineRulesActionSchema = z.object({
  type: z.literal('refine-rules'),
  feedback: z.string().min(1),
});

export const WorkspaceActionSchema = z.discriminatedUnion('type', [
  CreateActionSchema,
  FocusActionSchema,
  DissolveActionSchema,
  UpdateActionSchema,
  FuseActionSchema,
  RefineRulesActionSchema,
]);

export const IntentLLMOutputSchema = z.object({
  response: z.string().optional(),
  actions: z.array(WorkspaceActionSchema).optional(),
});

export type IntentLLMOutput = z.infer<typeof IntentLLMOutputSchema>;
