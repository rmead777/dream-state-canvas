/**
 * Next Moves Catalog — 25 curated prompts organized by category.
 *
 * Each entry declares its relevance signals: time windows, required
 * integrations, relevant card types, trigger types. The ranker in
 * `next-moves-ranker.ts` scores entries against live workspace state
 * and picks the top N for display.
 *
 * Edit this file to tune the prompts — each entry is pure data. If you
 * find yourself clicking the same thing every morning, ⭐ it in the UI
 * (favorites are stored in localStorage, not here).
 */

import type { ObjectType } from './workspace-types';

// ─── Types ──────────────────────────────────────────────────────────────────

export type NextMoveCategory =
  | 'cash'          // 💰 Cash & Financial
  | 'vendor'        // 🚨 Vendor & AP
  | 'revenue'       // 📈 Customer & Revenue
  | 'ops'           // 🏭 Ops & Unit Economics
  | 'strategic';    // 🔮 Strategic / Meta

export type IntegrationDependency = 'qb' | 'ragic' | 'email' | 'documents';

export interface NextMoveSignals {
  /** Hours of day when this move becomes MORE relevant (0-23). Empty = all-day. */
  hours?: number[];
  /** Days of week (0=Sun, 6=Sat) when boosted. Empty = all-week. */
  daysOfWeek?: number[];
  /** Card types that, when focused, boost this move. */
  relevantWhenFocused?: ObjectType[];
  /** Integrations this move REQUIRES. Entry is hidden if any are missing. */
  requiresIntegrations?: IntegrationDependency[];
  /** Keywords in recent queries that boost this move. */
  recentQueryKeywords?: string[];
  /** Automation trigger types that, when active, slam this move toward #1. */
  criticalTriggers?: string[];
  /** Base weight regardless of signals. Higher = shown more often. */
  baseWeight?: number;
}

export interface NextMoveEntry {
  id: string;
  label: string;            // Button text (short)
  query: string;            // Full prompt sent to Sherpa
  category: NextMoveCategory;
  description?: string;     // Shown in the "More" tray tooltip
  signals: NextMoveSignals;
}

// ─── Catalog ────────────────────────────────────────────────────────────────

export const NEXT_MOVES_CATALOG: NextMoveEntry[] = [
  // ═══ 💰 Cash & Financial ═══════════════════════════════════════════════════
  {
    id: 'cash-morning-brief',
    label: 'Morning brief',
    query: 'Run my morning brief',
    category: 'cash',
    description: '48hr snapshot: cash, AP, AR, emails, escalations',
    signals: {
      hours: [6, 7, 8, 9, 10],
      daysOfWeek: [1, 2, 3, 4, 5],
      baseWeight: 8,
    },
  },
  {
    id: 'cash-position-today',
    label: 'Cash position today',
    query: 'What\'s my cash position today?',
    category: 'cash',
    description: 'Live QB pull + Chase account breakdown',
    signals: {
      requiresIntegrations: ['qb'],
      recentQueryKeywords: ['cash', 'bank', 'balance'],
      baseWeight: 6,
    },
  },
  {
    id: 'cash-forecast-90',
    label: '90-day cash forecast',
    query: 'Build a 90-day cash forecast using QuickBooks AR/AP and Ragic pipeline',
    category: 'cash',
    description: 'Ragic pipeline + AR + AP payment schedule',
    signals: {
      requiresIntegrations: ['qb', 'ragic'],
      recentQueryKeywords: ['forecast', 'cash', 'projection', 'runway'],
      baseWeight: 4,
    },
  },
  {
    id: 'cash-bills-due',
    label: 'Bills due this week',
    query: 'What bills are due in the next 7 days, ranked by tier?',
    category: 'cash',
    description: 'AP aging filtered to next 7 days, ranked by tier',
    signals: {
      hours: [7, 8, 9, 10, 11],
      requiresIntegrations: ['qb'],
      recentQueryKeywords: ['bill', 'ap', 'due', 'payable'],
      baseWeight: 5,
    },
  },
  {
    id: 'cash-flow-signals',
    label: 'Cash flow signals',
    query: 'Show me cash flow signals from the last 30 days — unusual inflows, outflows, timing shifts',
    category: 'cash',
    description: 'Recent inflows/outflows pattern detection',
    signals: {
      requiresIntegrations: ['qb'],
      baseWeight: 3,
    },
  },

  // ═══ 🚨 Vendor & AP ════════════════════════════════════════════════════════
  {
    id: 'vendor-escalating',
    label: 'Who\'s escalating?',
    query: 'Who\'s escalating right now — active threats, lien letters, disconnect risks?',
    category: 'vendor',
    description: 'Active threats, lien letters, disconnect risks',
    signals: {
      requiresIntegrations: ['email'],
      recentQueryKeywords: ['escalation', 'threat', 'lien', 'disconnect'],
      criticalTriggers: ['escalation_detected', 'lien_letter', 'disconnect_risk'],
      baseWeight: 5,
    },
  },
  {
    id: 'vendor-intel-refresh',
    label: 'Refresh vendor intel',
    query: 'Refresh the vendor intelligence hub — re-sync all vendors with latest QuickBooks + emails',
    category: 'vendor',
    description: 'Re-sync all vendors with latest QB + emails',
    signals: {
      relevantWhenFocused: ['vendor-dossier', 'inspector'],
      requiresIntegrations: ['qb', 'email'],
      baseWeight: 3,
    },
  },
  {
    id: 'vendor-promises',
    label: 'Open promises',
    query: 'What promises have been made — show open outreach-tracker commitments with due dates',
    category: 'vendor',
    description: 'Open outreach-tracker commitments',
    signals: {
      relevantWhenFocused: ['outreach-tracker', 'action-queue'],
      recentQueryKeywords: ['promise', 'commitment', 'outreach'],
      baseWeight: 4,
    },
  },
  {
    id: 'vendor-payment-plan',
    label: 'Build payment plan',
    query: 'Build a payment plan optimized by vendor tier — tell me what cash amount to optimize for',
    category: 'vendor',
    description: 'Cash-planner optimizer by tier',
    signals: {
      relevantWhenFocused: ['cash-planner', 'action-queue'],
      requiresIntegrations: ['qb'],
      baseWeight: 4,
    },
  },
  {
    id: 'vendor-draft-updates',
    label: 'Draft Tier 1 updates',
    query: 'Draft payment update emails to Tier 1 vendors with specific amounts',
    category: 'vendor',
    description: 'Bulk draft with specific amounts',
    signals: {
      relevantWhenFocused: ['action-queue', 'outreach-tracker'],
      requiresIntegrations: ['qb', 'email'],
      baseWeight: 3,
    },
  },

  // ═══ 📈 Customer & Revenue ═════════════════════════════════════════════════
  {
    id: 'revenue-shipping-next-week',
    label: 'Shipping next week',
    query: 'What\'s shipping next week — Ragic pipeline by day, tons, revenue',
    category: 'revenue',
    description: 'Ragic pipeline by day, tons, revenue',
    signals: {
      daysOfWeek: [4, 5],
      requiresIntegrations: ['ragic'],
      recentQueryKeywords: ['ship', 'delivery', 'order', 'pipeline'],
      baseWeight: 4,
    },
  },
  {
    id: 'revenue-top-ar',
    label: 'Top 10 AR exposure',
    query: 'Show top 10 customers by AR exposure with aging — concentration risk',
    category: 'revenue',
    description: 'Concentration risk with aging',
    signals: {
      requiresIntegrations: ['qb'],
      recentQueryKeywords: ['ar', 'receivable', 'customer', 'exposure'],
      baseWeight: 4,
    },
  },
  {
    id: 'revenue-customer-dossier',
    label: 'Customer dossier',
    query: 'Build a full customer dossier — pick a customer and I\'ll pull their full profile',
    category: 'revenue',
    description: 'Full dossier with orders, AR, contacts, history',
    signals: {
      relevantWhenFocused: ['vendor-dossier', 'inspector'],
      requiresIntegrations: ['ragic'],
      baseWeight: 2,
    },
  },
  {
    id: 'revenue-pricing-leakage',
    label: 'Pricing leakage',
    query: 'Find pricing leakage across customers — contract price vs. invoiced ASP check',
    category: 'revenue',
    description: 'Contract vs. invoiced ASP check',
    signals: {
      requiresIntegrations: ['ragic', 'qb'],
      recentQueryKeywords: ['price', 'margin', 'leakage', 'contract'],
      baseWeight: 2,
    },
  },
  {
    id: 'revenue-forecast-60',
    label: '60-day revenue',
    query: 'Forecast revenue for the next 60 days — confirmed orders times collection timing',
    category: 'revenue',
    description: 'Confirmed orders × collection timing',
    signals: {
      requiresIntegrations: ['ragic', 'qb'],
      recentQueryKeywords: ['revenue', 'forecast', 'projection'],
      baseWeight: 3,
    },
  },

  // ═══ 🏭 Ops & Unit Economics ═══════════════════════════════════════════════
  {
    id: 'ops-unit-economics',
    label: 'Unit economics refresh',
    query: 'Refresh this month\'s unit economics — margin by product, freight impact',
    category: 'ops',
    description: 'Margin by product, freight impact',
    signals: {
      relevantWhenFocused: ['dataset', 'analysis', 'comparison'],
      recentQueryKeywords: ['unit', 'margin', 'economics', 'product'],
      baseWeight: 3,
    },
  },
  {
    id: 'ops-freight-analysis',
    label: 'Freight analysis',
    query: 'Freight cost analysis by customer — who\'s eating the freight, who\'s paying',
    category: 'ops',
    description: 'Who eats freight, who pays',
    signals: {
      recentQueryKeywords: ['freight', 'shipping', 'logistics'],
      baseWeight: 2,
    },
  },
  {
    id: 'ops-breakeven-mix',
    label: 'Breakeven by mix',
    query: 'Show breakeven by sand/powder mix — production-side scenario',
    category: 'ops',
    description: 'Sand/powder production scenario',
    signals: {
      recentQueryKeywords: ['breakeven', 'mix', 'production', 'sand', 'powder'],
      baseWeight: 2,
    },
  },
  {
    id: 'ops-margin-floor',
    label: 'Below-margin orders',
    query: 'Flag orders below the margin floor — scan Ragic for contribution margin under threshold',
    category: 'ops',
    description: 'Contribution margin floor scan',
    signals: {
      requiresIntegrations: ['ragic'],
      recentQueryKeywords: ['margin', 'contribution', 'floor'],
      baseWeight: 2,
    },
  },
  {
    id: 'ops-month-compare',
    label: 'Month-over-month',
    query: 'Compare this month to last month — P&L delta view',
    category: 'ops',
    description: 'P&L delta view',
    signals: {
      daysOfWeek: [1, 2, 3],
      requiresIntegrations: ['qb'],
      recentQueryKeywords: ['compare', 'month', 'pnl', 'delta'],
      baseWeight: 3,
    },
  },

  // ═══ 🔮 Strategic / Meta ═══════════════════════════════════════════════════
  {
    id: 'strategic-predictions',
    label: 'Open predictions',
    query: 'What predictions are open — show the predictions ledger with resolution dates',
    category: 'strategic',
    description: 'Predictions ledger with resolution dates',
    signals: {
      recentQueryKeywords: ['predict', 'forecast', 'ledger'],
      baseWeight: 2,
    },
  },
  {
    id: 'strategic-whats-changed',
    label: 'What\'s changed?',
    query: 'What\'s changed in the last week — diff view across cash, AP, emails',
    category: 'strategic',
    description: 'Week-over-week diff across all domains',
    signals: {
      daysOfWeek: [1, 5],
      baseWeight: 3,
    },
  },
  {
    id: 'strategic-biggest-risks',
    label: 'Biggest risks right now',
    query: 'What are the biggest risks right now — refresh the orbital risk diagram',
    category: 'strategic',
    description: 'Orbital risk diagram refresh',
    signals: {
      relevantWhenFocused: ['alert', 'production-risk', 'escalation-tracker'],
      recentQueryKeywords: ['risk', 'threat', 'danger'],
      criticalTriggers: ['risk_spike', 'escalation_detected'],
      baseWeight: 4,
    },
  },
  {
    id: 'strategic-24hr-intel',
    label: '24hr intel brief',
    query: 'Show me the critical emails and information I need to know that occurred over the past 24 hours',
    category: 'strategic',
    description: 'Critical emails + signals from last 24hr',
    signals: {
      hours: [6, 7, 8, 9, 10, 17, 18, 19],
      requiresIntegrations: ['email'],
      baseWeight: 6,
    },
  },
  {
    id: 'strategic-today-action',
    label: 'What should I tackle today?',
    query: 'What should I tackle today — action queue sequenced by urgency times impact',
    category: 'strategic',
    description: 'Action queue by urgency × impact',
    signals: {
      hours: [6, 7, 8, 9, 10, 11],
      daysOfWeek: [1, 2, 3, 4, 5],
      relevantWhenFocused: ['action-queue'],
      recentQueryKeywords: ['today', 'priority', 'action', 'tackle'],
      baseWeight: 5,
    },
  },
];

// ─── Category Display ───────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<NextMoveCategory, string> = {
  cash: '💰 Cash & Financial',
  vendor: '🚨 Vendor & AP',
  revenue: '📈 Customer & Revenue',
  ops: '🏭 Ops & Unit Economics',
  strategic: '🔮 Strategic',
};

export const CATEGORY_ORDER: NextMoveCategory[] = [
  'cash',
  'vendor',
  'revenue',
  'ops',
  'strategic',
];
