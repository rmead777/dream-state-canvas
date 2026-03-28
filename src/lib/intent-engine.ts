import {
  IntentResult,
  WorkspaceAction,
  WorkspaceObject,
} from './workspace-types';
import {
  SEED_LEVERAGE_DATA,
  SEED_COMPARISON_DATA,
  SEED_ALERT_DATA,
  SEED_INSPECTOR_DATA,
  SEED_BRIEF_DATA,
  SEED_TIMELINE_DATA,
  SEED_DOCUMENT_DATA,
  CANONICAL_DATASET,
} from './seed-data';
import { callAI } from '@/hooks/useAI';
import { analyzeDataset, refineProfile, getCurrentProfile, DataProfile } from './data-analyzer';
import { previewRows, alertRows, metricAggregate, comparisonPairs } from './data-slicer';

// Cached profile promise (runs once)
let profilePromise: Promise<DataProfile> | null = null;

function getProfile(): Promise<DataProfile> {
  if (!profilePromise) {
    profilePromise = analyzeDataset(CANONICAL_DATASET.columns, CANONICAL_DATASET.rows);
  }
  return profilePromise;
}

// Context builder — feeds workspace state to the LLM
function buildWorkspaceContext(objects: Record<string, WorkspaceObject>): string {
  const active = Object.values(objects).filter((o) => o.status !== 'dissolved');
  if (active.length === 0) return 'Workspace is empty.';

  return `Current workspace objects:\n${active
    .map((o) => `- [${o.type}] "${o.title}" (${o.status}${o.pinned ? ', pinned' : ''})${o.id ? ` id:${o.id}` : ''}`)
    .join('\n')}`;
}

// Seed data lookup for creating objects (used as fallback / for narrative types)
const SEED_DATA_BY_TYPE: Record<string, { data: Record<string, any>; defaultTitle: string }> = {
  metric: { data: SEED_LEVERAGE_DATA, defaultTitle: 'AP Exposure' },
  comparison: { data: SEED_COMPARISON_DATA, defaultTitle: 'Vendor Comparison' },
  alert: { data: SEED_ALERT_DATA, defaultTitle: 'Urgent Vendors' },
  inspector: { data: SEED_INSPECTOR_DATA, defaultTitle: 'Top Vendors' },
  brief: { data: SEED_BRIEF_DATA, defaultTitle: 'AP Risk Assessment' },
  timeline: { data: SEED_TIMELINE_DATA, defaultTitle: 'Vendor Activity' },
  document: { data: SEED_DOCUMENT_DATA, defaultTitle: 'AP Vendor Tracker v14' },
  dataset: { data: CANONICAL_DATASET, defaultTitle: 'Vendor Dataset' },
};

/**
 * Build dynamic data for an object type using the DataProfile + slicer.
 * Falls back to seed data if profile isn't ready yet.
 */
async function getDynamicData(objectType: string): Promise<Record<string, any>> {
  try {
    const profile = await getProfile();
    const { columns, rows } = CANONICAL_DATASET;

    switch (objectType) {
      case 'metric': {
        const agg = metricAggregate(columns, rows, profile);
        return {
          ...SEED_LEVERAGE_DATA,
          currentValue: agg.currentValue,
          unit: agg.unit,
          breakdown: agg.breakdown,
          sparkline: agg.sparkline,
          sparklineLabels: agg.sparklineLabels,
          context: agg.context,
          label: 'ap-exposure',
        };
      }
      case 'inspector': {
        const preview = previewRows(columns, rows, profile, 8);
        return { columns: preview.columns, rows: preview.rows };
      }
      case 'alert': {
        const alerts = alertRows(columns, rows, profile);
        return { alerts };
      }
      case 'comparison': {
        const comp = comparisonPairs(columns, rows, profile);
        return comp;
      }
      default:
        return SEED_DATA_BY_TYPE[objectType]?.data || {};
    }
  } catch {
    return SEED_DATA_BY_TYPE[objectType]?.data || {};
  }
}

/**
 * AI-powered intent parsing — calls the LLM, falls back to keyword matching.
 */
export async function parseIntentAI(
  input: string,
  existingObjects: Record<string, WorkspaceObject> = {}
): Promise<IntentResult> {
  try {
    const context = buildWorkspaceContext(existingObjects);
    const result = await callAI(
      [
        {
          role: 'user',
          content: `Workspace context:\n${context}\n\nUser query: "${input}"`,
        },
      ],
      'intent'
    );

    if (!result) throw new Error('No AI response');

    // Extract JSON from response (LLM may wrap in markdown)
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]);
    const actions: WorkspaceAction[] = [];

    if (parsed.response) {
      actions.push({ type: 'respond', message: parsed.response });
    }

    if (parsed.actions && Array.isArray(parsed.actions)) {
      for (const action of parsed.actions) {
        if (action.type === 'create' && action.objectType) {
          const seedInfo = SEED_DATA_BY_TYPE[action.objectType];
          // Use dynamic data for data-derived types, seed for narrative types
          const dynamicTypes = ['metric', 'inspector', 'alert', 'comparison'];
          const data = dynamicTypes.includes(action.objectType)
            ? await getDynamicData(action.objectType)
            : seedInfo?.data || {};
          actions.push({
            type: 'create',
            objectType: action.objectType,
            title: action.title || seedInfo?.defaultTitle || 'Untitled',
            data,
            relatedTo: action.relatedTo || [],
          });
        } else if (action.type === 'focus' && action.objectId) {
          actions.push({ type: 'focus', objectId: action.objectId });
        } else if (action.type === 'dissolve' && action.objectId) {
          actions.push({ type: 'dissolve', objectId: action.objectId });
        } else if (action.type === 'fuse' && action.objectIdA && action.objectIdB) {
          actions.push({ type: 'fuse', objectIdA: action.objectIdA, objectIdB: action.objectIdB });
        }
      }
    }

    return { actions: actions.length > 0 ? actions : [{ type: 'respond', message: parsed.response || 'I processed your request.' }] };
  } catch {
    // Fallback to keyword matching
    return parseIntent(input, existingObjects);
  }
}

// ─── Keyword fallback (kept for offline/error scenarios) ───────────────────

interface IntentPattern {
  keywords: string[];
  generate: (input: string, existingObjects: Record<string, WorkspaceObject>) => WorkspaceAction[] | Promise<WorkspaceAction[]>;
}

// Helper: find objects by fuzzy title match
function findObjectByName(name: string, objects: Record<string, WorkspaceObject>): WorkspaceObject | undefined {
  const lower = name.toLowerCase().trim();
  const active = Object.values(objects).filter(o => o.status !== 'dissolved');
  const exact = active.find(o => o.title.toLowerCase() === lower);
  if (exact) return exact;
  return active.find(o => o.title.toLowerCase().includes(lower) || lower.includes(o.title.toLowerCase()));
}

const patterns: IntentPattern[] = [
  {
    keywords: ['fuse', 'combine', 'merge', 'synthesize', 'blend'],
    generate: (input, existing) => {
      const active = Object.values(existing).filter(o => o.status !== 'dissolved');
      if (active.length < 2) {
        return [{ type: 'respond', message: 'You need at least two objects in your workspace to fuse. Create some objects first.' }];
      }

      const connectors = /(?:\band\b|\bwith\b|\b\+\b|\b&\b)/i;
      const fuseKeywords = /^(?:fuse|combine|merge|synthesize|blend)\s+/i;
      const stripped = input.replace(fuseKeywords, '').trim();
      const parts = stripped.split(connectors).map(s => s.trim()).filter(Boolean);

      if (parts.length >= 2) {
        const objA = findObjectByName(parts[0], existing);
        const objB = findObjectByName(parts[1], existing);
        if (objA && objB && objA.id !== objB.id) {
          return [
            { type: 'respond', message: `Fusing "${objA.title}" with "${objB.title}"...` },
            { type: 'fuse', objectIdA: objA.id, objectIdB: objB.id },
          ];
        }
      }

      const sorted = [...active].sort((a, b) => b.lastInteractedAt - a.lastInteractedAt);
      if (sorted.length >= 2) {
        return [
          { type: 'respond', message: `Fusing "${sorted[0].title}" with "${sorted[1].title}"...` },
          { type: 'fuse', objectIdA: sorted[0].id, objectIdB: sorted[1].id },
        ];
      }

      return [{ type: 'respond', message: 'Could not identify two objects to fuse.' }];
    },
  },
  {
    keywords: ['exposure', 'ap', 'payable', 'owed', 'total', 'leverage'],
    generate: async (input, existing) => {
      const hasMetric = Object.values(existing).some(
        (o) => o.type === 'metric' && o.context?.label === 'ap-exposure' && o.status !== 'dissolved'
      );
      if (hasMetric) {
        const obj = Object.values(existing).find(
          (o) => o.type === 'metric' && o.context?.label === 'ap-exposure'
        );
        return [
          { type: 'respond', message: 'AP exposure is already in your workspace.' },
          ...(obj ? [{ type: 'focus' as const, objectId: obj.id }] : []),
        ];
      }
      const data = await getDynamicData('metric');
      return [
        { type: 'respond', message: `Total AP is $${(data.currentValue / 1000000).toFixed(2)}M across ${CANONICAL_DATASET.rows.length} vendors.` },
        { type: 'create', objectType: 'metric', title: 'AP Exposure', data: { ...data, label: 'ap-exposure' } },
      ];
    },
  },
  {
    keywords: ['compare', 'versus', 'vs'],
    generate: async (input) => {
      const data = await getDynamicData('comparison');
      const title = data.entities?.length >= 2
        ? `${data.entities[0].name} vs ${data.entities[1].name}`
        : 'Vendor Comparison';
      return [
        { type: 'respond', message: 'Comparison ready. Showing contrasting profiles side by side.' },
        { type: 'create', objectType: 'comparison', title, data },
      ];
    },
  },
  {
    keywords: ['urgent', 'attention', 'priority', 'risk', 'alert', 'concern', 'action', 'tier 1', 'act now'],
    generate: async () => {
      const data = await getDynamicData('alert');
      const count = data.alerts?.length || 0;
      return [
        { type: 'respond', message: `${count} vendors need attention based on urgency analysis.` },
        { type: 'create', objectType: 'alert', title: 'Urgent Vendors', data },
      ];
    },
  },
  {
    keywords: ['table', 'top', 'inspect', 'overview', 'biggest', 'largest'],
    generate: async () => {
      const data = await getDynamicData('inspector');
      return [
        { type: 'respond', message: `Top vendors by priority. Showing ${data.rows?.length || 0} of ${CANONICAL_DATASET.rows.length}.` },
        { type: 'create', objectType: 'inspector', title: 'Top Vendors', data },
      ];
    },
  },
  {
    keywords: ['summary', 'brief', 'analysis', 'assessment'],
    generate: () => [
      { type: 'respond', message: 'AP risk assessment ready — covering all tiers, escalation patterns, and recommended actions.' },
      { type: 'create', objectType: 'brief', title: 'AP Risk Assessment', data: SEED_BRIEF_DATA },
    ],
  },
  {
    keywords: ['timeline', 'activity', 'history', 'recent', 'log', 'deadline'],
    generate: () => [
      { type: 'respond', message: 'Key vendor events and upcoming deadlines.' },
      { type: 'create', objectType: 'timeline', title: 'Vendor Activity', data: SEED_TIMELINE_DATA },
    ],
  },
  {
    keywords: ['document', 'report', 'pdf', 'read', 'tracker'],
    generate: () => [
      { type: 'respond', message: 'Opening the AP Vendor Tracker v14 document view.' },
      { type: 'create', objectType: 'document', title: 'AP Vendor Tracker v14', data: SEED_DOCUMENT_DATA },
    ],
  },
  {
    keywords: ['dataset', 'spreadsheet', 'full data', 'all vendor', 'full dataset', 'vendor list'],
    generate: () => [
      { type: 'respond', message: `Full vendor dataset ready — ${CANONICAL_DATASET.rows.length} vendors with balances, tier, and contact info.` },
      { type: 'create', objectType: 'dataset', title: 'Vendor Dataset', data: CANONICAL_DATASET },
    ],
  },
];

export async function parseIntent(
  input: string,
  existingObjects: Record<string, WorkspaceObject> = {}
): Promise<IntentResult> {
  const lower = input.toLowerCase().trim();

  for (const pattern of patterns) {
    if (pattern.keywords.some((kw) => lower.includes(kw))) {
      const result = pattern.generate(input, existingObjects);
      const actions = result instanceof Promise ? await result : result;
      return { actions };
    }
  }

  return {
    actions: [
      {
        type: 'respond',
        message: 'I can help with AP exposure, vendor comparisons, urgent vendor alerts, the full vendor dataset, risk assessments, or activity timelines. What would you like to explore?',
      },
    ],
  };
}
