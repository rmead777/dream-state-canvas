import { z } from 'zod';
import { CardSection } from './card-schema';

/**
 * Intent Schema — validates the STRUCTURE of AI output, not the CONTENT.
 *
 * DESIGN PRINCIPLE: Be permissive. The AI is smart and will produce
 * reasonable structures we haven't anticipated. Strict validation
 * (tight enums, required fields, exact shapes) REJECTS valid AI output
 * and causes silent failures. The action handlers and renderers already
 * handle unexpected values gracefully with defaults and fallbacks.
 *
 * What we validate:
 * - The top-level shape (response + actions array)
 * - Each action has a "type" field we can route on
 * - Create actions have an objectType we recognize
 *
 * What we DON'T validate:
 * - dataQuery contents (executor handles unknown operators)
 * - section contents (renderer skips unknown types)
 * - extra fields (passed through to handlers)
 */

// We validate objectType because we need to route to the right renderer.
// But we accept any string and let the renderer show a fallback for unknown types.
const KnownObjectTypes = [
  'metric', 'comparison', 'alert', 'inspector', 'brief',
  'timeline', 'monitor', 'document', 'dataset', 'analysis',
  'action-queue', 'vendor-dossier', 'cash-planner',
  'escalation-tracker', 'outreach-tracker', 'production-risk',
] as const;

// The action schema: we only validate enough to ROUTE the action.
// All other fields pass through to the handler untouched.
const ActionSchema = z.object({
  type: z.string(),
}).passthrough(); // passthrough lets any extra fields through

export const IntentLLMOutputSchema = z.object({
  response: z.string().optional(),
  actions: z.array(ActionSchema).optional(),
});

export type IntentLLMOutput = z.infer<typeof IntentLLMOutputSchema>;

// Re-export for backwards compat
export { CardSection };
