import {
  IntentResult,
  WorkspaceAction,
  WorkspaceObject,
} from './workspace-types';
import {
  MOCK_LEVERAGE_DATA,
  MOCK_COMPARISON_DATA,
  MOCK_ALERT_DATA,
  MOCK_INSPECTOR_DATA,
  MOCK_BRIEF_DATA,
  MOCK_TIMELINE_DATA,
  MOCK_DOCUMENT_DATA,
  MOCK_DATASET_DATA,
} from './mock-data';
import { callAI } from '@/hooks/useAI';

// Context builder — feeds workspace state to the LLM
function buildWorkspaceContext(objects: Record<string, WorkspaceObject>): string {
  const active = Object.values(objects).filter((o) => o.status !== 'dissolved');
  if (active.length === 0) return 'Workspace is empty.';

  return `Current workspace objects:\n${active
    .map((o) => `- [${o.type}] "${o.title}" (${o.status}${o.pinned ? ', pinned' : ''})${o.id ? ` id:${o.id}` : ''}`)
    .join('\n')}`;
}

// Mock data lookup for creating objects
const MOCK_DATA_BY_TYPE: Record<string, { data: Record<string, any>; defaultTitle: string }> = {
  metric: { data: MOCK_LEVERAGE_DATA, defaultTitle: 'AP Exposure' },
  comparison: { data: MOCK_COMPARISON_DATA, defaultTitle: 'Vendor Comparison' },
  alert: { data: MOCK_ALERT_DATA, defaultTitle: 'Urgent Vendors' },
  inspector: { data: MOCK_INSPECTOR_DATA, defaultTitle: 'Top Vendors' },
  brief: { data: MOCK_BRIEF_DATA, defaultTitle: 'AP Risk Assessment' },
  timeline: { data: MOCK_TIMELINE_DATA, defaultTitle: 'Vendor Activity' },
  document: { data: MOCK_DOCUMENT_DATA, defaultTitle: 'AP Vendor Tracker v14' },
  dataset: { data: MOCK_DATASET_DATA, defaultTitle: 'Vendor Dataset' },
};

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
          const mockInfo = MOCK_DATA_BY_TYPE[action.objectType];
          actions.push({
            type: 'create',
            objectType: action.objectType,
            title: action.title || mockInfo?.defaultTitle || 'Untitled',
            data: mockInfo?.data || {},
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
  generate: (input: string, existingObjects: Record<string, WorkspaceObject>) => WorkspaceAction[];
}

// Helper: find objects by fuzzy title match
function findObjectByName(name: string, objects: Record<string, WorkspaceObject>): WorkspaceObject | undefined {
  const lower = name.toLowerCase().trim();
  const active = Object.values(objects).filter(o => o.status !== 'dissolved');
  // Exact match first
  const exact = active.find(o => o.title.toLowerCase() === lower);
  if (exact) return exact;
  // Partial match
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

      // Try to extract two object names from patterns like "fuse X and Y" or "combine X with Y"
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

      // If we can't identify specific objects, fuse the two most recently interacted
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
    generate: (input, existing) => {
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
      return [
        { type: 'respond', message: 'Total AP is $2.77M across 191 vendors. Tier 1 urgent: $158K across 5 vendors requiring immediate action.' },
        { type: 'create', objectType: 'metric', title: 'AP Exposure', data: { ...MOCK_LEVERAGE_DATA, label: 'ap-exposure' } },
      ];
    },
  },
  {
    keywords: ['compare', 'versus', 'vs'],
    generate: (input) => {
      const vendorNames = ['acme', 'vac2go', 'delta ducon', 'coverall', 'mcgriff', 'white oak', 'csx', 'alabama power'];
      const mentioned = vendorNames.filter((f) => input.toLowerCase().includes(f));
      const title = mentioned.length >= 2
        ? mentioned.map((n) => n.charAt(0).toUpperCase() + n.slice(1)).join(' vs ')
        : 'Vendor Comparison';
      return [
        { type: 'respond', message: 'Comparison ready. Showing Tier 1 vendor risk profiles side by side.' },
        { type: 'create', objectType: 'comparison', title, data: MOCK_COMPARISON_DATA },
      ];
    },
  },
  {
    keywords: ['urgent', 'attention', 'priority', 'risk', 'alert', 'concern', 'action', 'tier 1', 'act now'],
    generate: () => [
      { type: 'respond', message: '11 vendors across Tier 1 and Tier 2 need attention. 5 Tier 1 vendors have active legal threats, lien filings, or service suspensions.' },
      { type: 'create', objectType: 'alert', title: 'Urgent Vendors', data: MOCK_ALERT_DATA },
    ],
  },
  {
    keywords: ['table', 'top', 'inspect', 'overview', 'biggest', 'largest'],
    generate: () => [
      { type: 'respond', message: 'Top vendors by outstanding balance. CSX Transportation leads at $523K.' },
      { type: 'create', objectType: 'inspector', title: 'Top Vendors', data: MOCK_INSPECTOR_DATA },
    ],
  },
  {
    keywords: ['summary', 'brief', 'analysis', 'assessment'],
    generate: () => [
      { type: 'respond', message: 'AP risk assessment ready — covering all tiers, escalation patterns, and recommended actions.' },
      { type: 'create', objectType: 'brief', title: 'AP Risk Assessment', data: MOCK_BRIEF_DATA },
    ],
  },
  {
    keywords: ['timeline', 'activity', 'history', 'recent', 'log', 'deadline'],
    generate: () => [
      { type: 'respond', message: 'Key vendor events and upcoming deadlines.' },
      { type: 'create', objectType: 'timeline', title: 'Vendor Activity', data: MOCK_TIMELINE_DATA },
    ],
  },
  {
    keywords: ['document', 'report', 'pdf', 'read', 'tracker'],
    generate: () => [
      { type: 'respond', message: 'Opening the AP Vendor Tracker v14 document view.' },
      { type: 'create', objectType: 'document', title: 'AP Vendor Tracker v14', data: MOCK_DOCUMENT_DATA },
    ],
  },
  {
    keywords: ['dataset', 'spreadsheet', 'full data', 'all vendor', 'full dataset', 'vendor list'],
    generate: () => [
      { type: 'respond', message: 'Full vendor dataset ready — 30 largest vendors with balances, tier, and contact info.' },
      { type: 'create', objectType: 'dataset', title: 'Vendor Dataset', data: MOCK_DATASET_DATA },
    ],
  },
];

export function parseIntent(
  input: string,
  existingObjects: Record<string, WorkspaceObject> = {}
): IntentResult {
  const lower = input.toLowerCase().trim();

  for (const pattern of patterns) {
    if (pattern.keywords.some((kw) => lower.includes(kw))) {
      return { actions: pattern.generate(input, existingObjects) };
    }
  }

  return {
    actions: [
      {
        type: 'respond',
        message: 'I can help with leverage exposure, fund comparisons, risk alerts, portfolio data, summaries, or activity timelines. What would you like to explore?',
      },
    ],
  };
}
