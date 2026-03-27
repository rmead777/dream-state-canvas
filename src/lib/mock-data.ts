// Realistic mock data for workspace objects

export const MOCK_LEVERAGE_DATA = {
  currentValue: 3.2,
  unit: 'x',
  trend: 'increasing',
  change: +0.4,
  changePeriod: '30d',
  sparkline: [2.6, 2.7, 2.8, 2.8, 2.9, 3.0, 3.0, 3.1, 3.2, 3.2],
  threshold: { warning: 3.0, critical: 4.0 },
  context: 'Net Debt / EBITDA ratio across the portfolio. Approaching warning threshold.',
  breakdown: [
    { name: 'Fund Alpha', value: 2.8 },
    { name: 'Fund Beta', value: 3.6 },
    { name: 'Fund Gamma', value: 3.1 },
  ],
};

export const MOCK_COMPARISON_DATA = {
  entities: [
    {
      name: 'Fund Alpha',
      metrics: {
        aum: '$2.4B',
        leverage: '2.8x',
        returnYTD: '+12.4%',
        riskScore: 'Low',
        sector: 'Technology',
        vintage: '2021',
      },
    },
    {
      name: 'Fund Gamma',
      metrics: {
        aum: '$1.8B',
        leverage: '3.1x',
        returnYTD: '+8.7%',
        riskScore: 'Medium',
        sector: 'Healthcare',
        vintage: '2022',
      },
    },
  ],
  highlights: [
    { metric: 'leverage', insight: 'Gamma is 11% more leveraged than Alpha' },
    { metric: 'returnYTD', insight: 'Alpha outperforming by 370bps YTD' },
  ],
};

export const MOCK_ALERT_DATA = {
  alerts: [
    {
      id: 'a1',
      severity: 'high' as const,
      title: 'Covenant breach risk — Fund Beta',
      description: 'Leverage ratio at 3.6x, breaching 3.5x covenant threshold within 15 days at current trajectory.',
      timestamp: Date.now() - 1800000,
      actionable: true,
    },
    {
      id: 'a2',
      severity: 'medium' as const,
      title: 'Concentration limit approaching — Tech sector',
      description: 'Portfolio tech allocation at 38%, limit is 40%. Two pending deals would exceed.',
      timestamp: Date.now() - 7200000,
      actionable: true,
    },
    {
      id: 'a3',
      severity: 'low' as const,
      title: 'NAV reconciliation pending',
      description: 'Q3 NAV statements from 3 funds awaiting administrator confirmation.',
      timestamp: Date.now() - 86400000,
      actionable: false,
    },
  ],
};

export const MOCK_INSPECTOR_DATA = {
  columns: ['Fund', 'AUM', 'Leverage', 'Return YTD', 'Risk', 'Status'],
  rows: [
    ['Alpha', '$2.4B', '2.8x', '+12.4%', 'Low', 'Active'],
    ['Beta', '$3.1B', '3.6x', '+6.2%', 'High', 'Watch'],
    ['Gamma', '$1.8B', '3.1x', '+8.7%', 'Medium', 'Active'],
    ['Delta', '$950M', '1.9x', '+15.1%', 'Low', 'Active'],
    ['Epsilon', '$2.7B', '2.4x', '+11.3%', 'Low', 'Active'],
  ],
};

export const MOCK_BRIEF_DATA = {
  title: 'Portfolio Risk Summary',
  generatedAt: Date.now(),
  content: `Portfolio leverage has increased 15% over the past quarter, driven primarily by Fund Beta's aggressive deployment strategy. Two key risks require attention:

**Covenant Risk**: Fund Beta is approaching its 3.5x leverage covenant. At current trajectory, a breach is likely within 15 days unless distributions are accelerated or new equity is called.

**Concentration**: Technology sector allocation is at 38% against a 40% limit. The pending Nexus and Orbital deals would push this to 44%.

Recommended actions: (1) Initiate early distribution discussion with Beta GP, (2) Defer one tech deal or rebalance via secondary sale.`,
  confidence: 0.92,
  sources: ['Fund Beta Q3 Report', 'Portfolio Monitoring System', 'Deal Pipeline'],
};

export const MOCK_TIMELINE_DATA = {
  events: [
    { id: 't1', timestamp: Date.now() - 300000, type: 'system', content: 'Fund Beta leverage crossed 3.5x warning threshold' },
    { id: 't2', timestamp: Date.now() - 1800000, type: 'user', content: 'Reviewed Alpha vs Gamma comparison' },
    { id: 't3', timestamp: Date.now() - 3600000, type: 'ai', content: 'Generated risk brief for portfolio committee' },
    { id: 't4', timestamp: Date.now() - 7200000, type: 'system', content: 'NAV update received for Fund Delta' },
    { id: 't5', timestamp: Date.now() - 14400000, type: 'user', content: 'Pinned leverage monitor to workspace' },
    { id: 't6', timestamp: Date.now() - 28800000, type: 'ai', content: 'Detected concentration risk in tech sector' },
  ],
};

export const MOCK_DOCUMENT_DATA = {
  fileName: 'Q3 Portfolio Risk Assessment.pdf',
  summary: 'Portfolio leverage has increased 15% over the past quarter. Two funds are approaching covenant thresholds, and technology sector concentration is nearing its 40% limit. The report recommends accelerating distributions for Fund Beta and deferring one pending tech acquisition.',
  paragraphs: [
    'The Q3 2024 Portfolio Risk Assessment examines the current state of leverage, sector concentration, and covenant compliance across all active fund positions. This report is prepared for the investment committee and covers the period ending September 30, 2024.',
    'Portfolio-wide leverage has increased from 2.8x to 3.2x Net Debt/EBITDA over the quarter, driven primarily by Fund Beta\'s aggressive deployment strategy. This represents a 15% increase and places the portfolio closer to internal warning thresholds than at any point in the past 18 months.',
    'Fund Beta is the primary driver of concern, with leverage at 3.6x against a covenant ceiling of 3.5x. At current trajectory, a formal covenant breach is likely within 15 days unless corrective action is taken. Recommended actions include initiating early distribution discussions with the GP and evaluating the feasibility of an equity call.',
    'Technology sector allocation has reached 38% of the total portfolio, against an internal limit of 40%. Two pending deals — Nexus Systems ($120M) and Orbital Analytics ($85M) — would push this allocation to approximately 44% if both proceed. The committee should consider deferring one deal or rebalancing through a secondary market sale.',
    'Fund Alpha continues to perform well at 2.8x leverage with a +12.4% YTD return, representing the strongest risk-adjusted position in the portfolio. Fund Delta, at 1.9x leverage and +15.1% YTD return, is the lowest-risk, highest-return position and may warrant increased allocation.',
    'In summary, the portfolio requires immediate attention on two fronts: Fund Beta covenant risk and technology sector concentration. Both issues are manageable with timely action, but inaction creates compounding risk over the next 30 days.',
  ],
};

export const MOCK_DATASET_DATA = {
  columns: ['Fund', 'AUM', 'Leverage', 'Return YTD', 'Risk Score', 'Status', 'Vintage', 'Sector'],
  rows: [
    ['Alpha', '$2.4B', '2.8x', '+12.4%', 'Low', 'Active', '2021', 'Technology'],
    ['Beta', '$3.1B', '3.6x', '+6.2%', 'High', 'Watch', '2020', 'Healthcare'],
    ['Gamma', '$1.8B', '3.1x', '+8.7%', 'Medium', 'Active', '2022', 'Healthcare'],
    ['Delta', '$950M', '1.9x', '+15.1%', 'Low', 'Active', '2023', 'Energy'],
    ['Epsilon', '$2.7B', '2.4x', '+11.3%', 'Low', 'Active', '2021', 'Technology'],
    ['Zeta', '$1.2B', '2.1x', '+9.8%', 'Low', 'Active', '2022', 'Consumer'],
    ['Eta', '$3.4B', '2.9x', '+7.5%', 'Medium', 'Active', '2020', 'Industrial'],
  ],
};

export const DEFAULT_SUGGESTIONS = [
  { id: 's1', label: 'Show leverage exposure', query: 'show me leverage exposure', priority: 1 },
  { id: 's2', label: 'What needs attention?', query: 'what should I focus on?', priority: 2 },
  { id: 's3', label: 'Open portfolio dataset', query: 'show the full dataset', priority: 3 },
];
