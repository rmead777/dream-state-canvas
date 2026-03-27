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
} from './mock-data';

// Intent patterns — keyword-based for v1, structured for future LLM replacement
interface IntentPattern {
  keywords: string[];
  generate: (input: string, existingObjects: Record<string, WorkspaceObject>) => WorkspaceAction[];
}

const patterns: IntentPattern[] = [
  {
    keywords: ['leverage', 'debt', 'ratio'],
    generate: (input, existing) => {
      const hasLeverage = Object.values(existing).some(
        (o) => o.type === 'metric' && o.context?.label === 'leverage' && o.status !== 'dissolved'
      );
      if (hasLeverage) {
        const obj = Object.values(existing).find(
          (o) => o.type === 'metric' && o.context?.label === 'leverage'
        );
        return [
          { type: 'respond', message: 'Leverage exposure is already in your workspace. I\'ve brought it into focus.' },
          ...(obj ? [{ type: 'focus' as const, objectId: obj.id }] : []),
        ];
      }
      return [
        { type: 'respond', message: 'Here\'s the current leverage position across the portfolio. Beta is approaching covenant threshold.' },
        {
          type: 'create',
          objectType: 'metric',
          title: 'Leverage Exposure',
          data: { ...MOCK_LEVERAGE_DATA, label: 'leverage' },
        },
      ];
    },
  },
  {
    keywords: ['compare', 'versus', 'vs'],
    generate: (input) => {
      const fundNames = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
      const mentioned = fundNames.filter((f) => input.toLowerCase().includes(f));
      const title =
        mentioned.length >= 2
          ? `${mentioned.map((n) => n.charAt(0).toUpperCase() + n.slice(1)).join(' vs ')}`
          : 'Fund Comparison';
      return [
        { type: 'respond', message: `Comparison surface ready. Key divergence is in leverage and YTD returns.` },
        {
          type: 'create',
          objectType: 'comparison',
          title,
          data: MOCK_COMPARISON_DATA,
        },
      ];
    },
  },
  {
    keywords: ['focus', 'attention', 'priority', 'risk', 'alert', 'concern'],
    generate: () => [
      {
        type: 'respond',
        message: 'Two items need attention. Beta\'s covenant risk is most urgent — I\'ve surfaced the detail.',
      },
      {
        type: 'create',
        objectType: 'alert',
        title: 'Priority Alerts',
        data: MOCK_ALERT_DATA,
      },
    ],
  },
  {
    keywords: ['table', 'data', 'inspect', 'portfolio', 'funds', 'overview'],
    generate: () => [
      { type: 'respond', message: 'Portfolio data inspector is ready. All active funds and key metrics.' },
      {
        type: 'create',
        objectType: 'inspector',
        title: 'Portfolio Overview',
        data: MOCK_INSPECTOR_DATA,
      },
    ],
  },
  {
    keywords: ['summary', 'brief', 'report', 'analysis'],
    generate: () => [
      { type: 'respond', message: 'I\'ve prepared a risk brief based on current portfolio state.' },
      {
        type: 'create',
        objectType: 'brief',
        title: 'Risk Brief',
        data: MOCK_BRIEF_DATA,
      },
    ],
  },
  {
    keywords: ['timeline', 'activity', 'history', 'recent', 'log'],
    generate: () => [
      { type: 'respond', message: 'Here\'s the recent workspace activity and system events.' },
      {
        type: 'create',
        objectType: 'timeline',
        title: 'Activity Timeline',
        data: MOCK_TIMELINE_DATA,
      },
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

  // Fallback — no match
  return {
    actions: [
      {
        type: 'respond',
        message: 'I can help with leverage exposure, fund comparisons, risk alerts, portfolio data, summaries, or activity timelines. What would you like to explore?',
      },
    ],
  };
}
