import {
  IntentResult,
  ActiveContext,
  ObjectType,
  WorkspaceAction,
  WorkspaceObject,
} from './workspace-types';
import { IntentLLMOutputSchema } from './intent-schema';
import { getConversationMessages } from './conversation-memory';
import { getAdminSettings } from './admin-settings';
import {
  SEED_LEVERAGE_DATA,
  SEED_COMPARISON_DATA,
  SEED_ALERT_DATA,
  SEED_INSPECTOR_DATA,
  SEED_BRIEF_DATA,
  SEED_TIMELINE_DATA,
  SEED_DOCUMENT_DATA,
} from './seed-data';
import { getActiveDataset } from './active-dataset';
import { callAI } from '@/hooks/useAI';
import { analyzeDataset, refineProfile, DataProfile, getCurrentProfile } from './data-analyzer';
import { previewRows, alertRows, metricAggregate, comparisonPairs } from './data-slicer';
import { buildDefaultViewState, buildWorkspaceIntentContext } from './workspace-intelligence';

// Cached profile promise (runs once, invalidated on refinement)
let profilePromise: Promise<DataProfile> | null = null;

function getProfile(): Promise<DataProfile> {
  if (!profilePromise) {
    const ds = getActiveDataset();
    profilePromise = analyzeDataset(ds.columns, ds.rows);
  }
  return profilePromise;
}

/** Invalidate cached profile so next getProfile() re-fetches from cache/AI. */
export function invalidateProfileCache(): void {
  profilePromise = null;
}

/**
 * Refine data prioritization rules based on user feedback.
 * Returns the updated profile and invalidates the cached promise.
 */
export async function refineDataRules(userFeedback: string): Promise<DataProfile> {
  const current = await getProfile();
  const ds = getActiveDataset();
  const updated = await refineProfile(
    ds.columns,
    ds.rows,
    current,
    userFeedback
  );
  // Replace the cached promise with the updated profile
  profilePromise = Promise.resolve(updated);
  return updated;
}

function withContextMeta(
  objectType: string,
  data: Record<string, unknown>,
  profile: DataProfile | null
): Record<string, unknown> {
  const view = buildDefaultViewState(objectType as ObjectType, data, profile);
  return Object.keys(view).length > 0 ? { ...data, view } : data;
}

async function buildIntentPayloadContext(
  objects: Record<string, WorkspaceObject>,
  activeContext?: ActiveContext
): Promise<string> {
  const ds = getActiveDataset();
  const profile = getCurrentProfile(ds.columns, ds.rows) ?? await getProfile().catch(() => null);
  return buildWorkspaceIntentContext({
    objects,
    activeContext,
    profile,
  });
}

// Seed data lookup for creating objects (used as fallback / for narrative types)
// Note: dataset uses a getter so it always reflects the current active dataset,
// not the one captured at module load time (HI-011 fix).
const SEED_DATA_BY_TYPE: Record<string, { data: Record<string, unknown>; defaultTitle: string }> = {
  metric: { data: SEED_LEVERAGE_DATA, defaultTitle: 'AP Exposure' },
  comparison: { data: SEED_COMPARISON_DATA, defaultTitle: 'Vendor Comparison' },
  alert: { data: SEED_ALERT_DATA, defaultTitle: 'Urgent Vendors' },
  inspector: { data: SEED_INSPECTOR_DATA, defaultTitle: 'Top Vendors' },
  brief: { data: SEED_BRIEF_DATA, defaultTitle: 'AP Risk Assessment' },
  timeline: { data: SEED_TIMELINE_DATA, defaultTitle: 'Vendor Activity' },
  document: { data: SEED_DOCUMENT_DATA, defaultTitle: 'AP Vendor Tracker v14' },
  get dataset() { return { data: getActiveDataset() as unknown as Record<string, unknown>, defaultTitle: 'Full Portfolio Dataset' }; },
};

/**
 * Build dynamic data for an object type using the DataProfile + slicer.
 * Falls back to seed data if profile isn't ready yet.
 */
async function getDynamicData(objectType: string): Promise<Record<string, unknown>> {
  try {
    const profile = await getProfile();
    const { columns, rows } = getActiveDataset();

    switch (objectType) {
      case 'metric': {
        const agg = metricAggregate(columns, rows, profile);
        return withContextMeta(objectType, {
          ...SEED_LEVERAGE_DATA,
          currentValue: agg.currentValue,
          unit: agg.unit,
          breakdown: agg.breakdown,
          sparkline: agg.sparkline,
          sparklineLabels: agg.sparklineLabels,
          context: agg.context,
          label: 'ap-exposure',
        }, profile);
      }
      case 'inspector': {
        const preview = previewRows(columns, rows, profile, 8);
        return withContextMeta(objectType, { columns: preview.columns, rows: preview.rows }, profile);
      }
      case 'alert': {
        const alerts = alertRows(columns, rows, profile);
        return withContextMeta(objectType, { alerts }, profile);
      }
      case 'comparison': {
        const comp = comparisonPairs(columns, rows, profile);
        return withContextMeta(objectType, comp, profile);
      }
      case 'dataset': {
        // Sort the full dataset by profile rules so preview shows correct order
        const sorted = previewRows(columns, rows, profile, rows.length);
        return withContextMeta(objectType, { columns: sorted.columns, rows: sorted.rows }, profile);
      }
      default:
        return withContextMeta(objectType, SEED_DATA_BY_TYPE[objectType]?.data || {}, profile);
    }
  } catch {
    return withContextMeta(objectType, SEED_DATA_BY_TYPE[objectType]?.data || {}, null);
  }
}

/**
 * AI-powered intent parsing — calls the LLM, falls back to keyword matching.
 */
export async function parseIntentAI(
  input: string,
  existingObjects: Record<string, WorkspaceObject> = {},
  documentIds?: string[],
  activeContext?: ActiveContext,
  memories?: string
): Promise<IntentResult> {
  try {
    const context = await buildIntentPayloadContext(existingObjects, activeContext);
    const { contextWindow } = getAdminSettings();

    // Build conversation history for follow-up awareness
    const history = getConversationMessages(contextWindow);
    // Build focused-card context so the AI knows EXACTLY what the user is looking at
    const focusedId = activeContext?.focusedObjectId;
    const focusedObject = focusedId ? existingObjects[focusedId] : null;
    let focusedCardHint = '';
    if (focusedObject) {
      const rowCount = Array.isArray(focusedObject.context?.rows) ? focusedObject.context.rows.length : null;
      const currentLimit = focusedObject.context?.dataQuery?.limit || focusedObject.context?.view?.limit || null;
      focusedCardHint = [
        `\nFOCUSED CARD (the user is looking at this right now):`,
        `  ID: ${focusedObject.id}`,
        `  Type: ${focusedObject.type}`,
        `  Title: "${focusedObject.title}"`,
        rowCount !== null ? `  Currently showing: ${rowCount} rows` : null,
        currentLimit ? `  Current limit: ${currentLimit}` : null,
        `  → If the user says "this", "it", "the card", "show more", "filter", "change" — they mean THIS card.`,
        `  → Use "update" with objectId "${focusedObject.id}" — NEVER use "refine-rules" or "create".`,
      ].filter(Boolean).join('\n');
    }

    const messages = [
      ...history,
      {
        role: 'user' as const,
        content: [
          'Resolve the user intent against the current workspace snapshot.',
          'CRITICAL: If ANY existing card could satisfy the request, use "update" or "focus" — NEVER "create" a duplicate and NEVER "refine-rules" for a card-specific request.',
          focusedCardHint,
          `Workspace intent payload:\n${context}`,
          `User query: "${input}"`,
        ].filter(Boolean).join('\n\n'),
      },
    ];

    const result = await callAI(
      messages,
      'intent',
      documentIds,
      memories
    );

    if (!result) throw new Error('No AI response');

    // Extract JSON from response (LLM may wrap in markdown)
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const raw = JSON.parse(jsonMatch[0]);

    // Validate with Zod — rejects unknown objectTypes, malformed actions
    const validated = IntentLLMOutputSchema.safeParse(raw);
    if (!validated.success) {
      console.warn('[intent-engine] LLM output failed Zod validation:', validated.error.issues);
      throw new Error('Invalid LLM output');
    }

    const parsed = validated.data;
    const actions: WorkspaceAction[] = [];

    if (parsed.response) {
      actions.push({ type: 'respond', message: parsed.response });
    }

    if (parsed.actions) {
      for (const action of parsed.actions) {
        if (action.type === 'create') {
          const seedInfo = SEED_DATA_BY_TYPE[action.objectType];
          const dynamicTypes = ['metric', 'inspector', 'alert', 'comparison', 'dataset'];
          const data = dynamicTypes.includes(action.objectType)
            ? await getDynamicData(action.objectType)
            : seedInfo?.data || {};
          actions.push({
            type: 'create',
            objectType: action.objectType,
            title: action.title || seedInfo?.defaultTitle || 'Untitled',
            data,
            relatedTo: action.relatedTo || [],
            // Pass through AI-generated rich content — don't discard it
            ...(action.sections ? { sections: action.sections } : {}),
            ...(action.dataQuery ? { dataQuery: action.dataQuery } : {}),
          });
        } else if (action.type === 'focus') {
          actions.push({ type: 'focus', objectId: action.objectId });
        } else if (action.type === 'dissolve') {
          actions.push({ type: 'dissolve', objectId: action.objectId });
        } else if (action.type === 'update') {
          // Pass through ALL AI-provided fields — dataQuery, sections, sectionOperations
          actions.push({
            type: 'update',
            objectId: action.objectId,
            instruction: action.instruction,
            ...(action.dataQuery ? { dataQuery: action.dataQuery } : {}),
            ...(action.sections ? { sections: action.sections } : {}),
            ...(action.sectionOperations ? { sectionOperations: action.sectionOperations } : {}),
          });
        } else if (action.type === 'fuse') {
          actions.push({ type: 'fuse', objectIdA: action.objectIdA, objectIdB: action.objectIdB });
        } else if (action.type === 'refine-rules') {
          actions.push({ type: 'refine-rules', feedback: action.feedback });
        }
      }
    }

    return { actions: actions.length > 0 ? actions : [{ type: 'respond', message: parsed.response || 'I processed your request.' }] };
  } catch {
    // Fallback to a safe no-op response when AI is unavailable or returns invalid JSON.
    return parseIntent(input, existingObjects);
  }
}

export async function parseIntent(
  _input: string,
  _existingObjects: Record<string, WorkspaceObject> = {}
): Promise<IntentResult> {
  return {
    actions: [
      {
        type: 'respond',
        message: 'I could not safely infer a workspace action without the AI planner. Please try again in a moment, or rephrase with the exact object you want me to update or focus.',
      },
    ],
  };
}
