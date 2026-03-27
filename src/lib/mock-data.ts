// Real data extracted from INCOA AP Vendor Tracker v14 (March 27, 2026)

export const MOCK_LEVERAGE_DATA = {
  currentValue: 2770713,
  unit: '$',
  trend: 'increasing',
  change: +158259,
  changePeriod: 'Tier 1 urgent',
  sparkline: [158259, 152291, 1834096, 626067],
  sparklineLabels: ['Act Now', 'Unblock', 'Monitor', 'Pay Later'],
  threshold: { warning: 2000000, critical: 3000000 },
  context: 'Total AP owed across 191 vendors (excl. Belfond). Tier 1 urgent: $158K across 5 vendors requiring immediate action.',
  breakdown: [
    { name: 'Tier 1 — Act Now', value: 158259 },
    { name: 'Tier 2 — Unblock', value: 152291 },
    { name: 'Tier 3 — Monitor', value: 1834096 },
    { name: 'Tier 4 — Pay Later', value: 626067 },
  ],
};

export const MOCK_COMPARISON_DATA = {
  entities: [
    {
      name: 'Acme-Hardesty',
      metrics: {
        balance: '$81,747',
        tier: 'Tier 1 — Act Now',
        daysSilent: '22d',
        emails: '24',
        escalation: 'Legal + Collections',
        risk: 'Raw Materials (Chemicals)',
      },
    },
    {
      name: 'Vac2Go',
      metrics: {
        balance: '$37,220',
        tier: 'Tier 1 — Act Now',
        daysSilent: '10d',
        emails: '45',
        escalation: 'Legal + Collections',
        risk: 'Environmental Services',
      },
    },
  ],
  highlights: [
    { metric: 'balance', insight: 'Acme-Hardesty owes 2.2x more than Vac2Go but has a payment plan in progress' },
    { metric: 'escalation', insight: 'Both vendors have escalated to legal action and collections referral' },
  ],
};

export const MOCK_ALERT_DATA = {
  alerts: [
    {
      id: 'a1',
      severity: 'high' as const,
      title: 'Vac2Go — $37,220',
      description: 'INCOA\'s new CFO Holly Johnson emailed Don Pulford on 3/17/2026: \'I am the new CFO at Incoa and I have been here a little under 1 month. I am meeting with the Ops team today at 11am and should have a response for you this afternoon.\' Vac2Go had reques',
      timestamp: Date.now() - 864000000,
      actionable: true,
    },
    {
      id: 'a2',
      severity: 'high' as const,
      title: 'Delta Ducon LLC (Natalie Newnom) — $27,831',
      description: 'Natalie Newnom (Delta Ducon LLC) sent 3rd request on 3/10/2026 for Invoice 4839 ($27,830.80), now 52 days past due. Escalated to David Difo and Wendy Childs: \'This will affect any pending project and puts customer in pre pay status after 60 days and ',
      timestamp: Date.now() - 1468800000,
      actionable: true,
    },
    {
      id: 'a3',
      severity: 'high' as const,
      title: 'Coverall Service — $7,624',
      description: 'Letitia Davis (Franchise Advisor) sent formal suspension notice: \'Due to non-payment of your outstanding balance of $3,912.00, Coverall will suspend janitorial services effective March 31, 2026, unless payment is received in full no later than March ',
      timestamp: Date.now() - 86400000,
      actionable: true,
    },
    {
      id: 'a4',
      severity: 'high' as const,
      title: 'McGriff Tire (JoAnne Dunagan) — $3,837',
      description: 'McGriff Tire credit dept. Jo Dunagan\'s follow-up on 3/17/2026: \'I am following up on the two past due invoices that we discussed and I emailed you about on 03/04/2026... The invoices were due in September and October. The account is currently locked ',
      timestamp: Date.now() - 864000000,
      actionable: true,
    },
    {
      id: 'a5',
      severity: 'high' as const,
      title: 'Acme-Hardesty — $81,747',
      description: 'Vendor\'s Senior Controller Brittany VanGilder emailed on 3/5/2026 requesting urgent update on payment plan for SINV054091 ($40,873.29) and SINV054256 ($40,873.28): \'Without communication and progress toward the past due balances, we will proceed with',
      timestamp: Date.now() - 1900800000,
      actionable: true,
    },
    {
      id: 'a6',
      severity: 'medium' as const,
      title: 'White Oak Logistics — $52,520',
      description: 'Highly active vendor (50 emails). Most recent exchange 3/23/2026: Holly Johnson (new CFO) gave her number (251-610-8708) and White Oak\'s Luke Hughes confirmed their CFO Chandra Johnson would call the next afternoon. Payments over 100-200 days old hav',
      timestamp: Date.now() - 345600000,
      actionable: true,
    },
    {
      id: 'a7',
      severity: 'medium' as const,
      title: 'Power & Rubber Supply (Carrie Fendley) — $50,953',
      description: 'Power & Rubber Supply AR. Last email 2/12/2026: Carrie said INCOA maintenance placed an order and claimed payment was coming that week. She cleared the order but warned: \'pickup/delivery of that order will be contingent on receiving that payment. Onc',
      timestamp: Date.now() - 259200000,
      actionable: true,
    },
    {
      id: 'a8',
      severity: 'medium' as const,
      title: 'EquipmentShare — $34,579',
      description: 'Angie Hobbs emailed 3/4/2026: 4 invoices totaling $9,418.04 highlighted in red needing payment, last payment received Dec 2025. \'To keep the account from being placed on hold for rentals, please provide a payment status for all past due invoices by W',
      timestamp: Date.now() - 1987200000,
      actionable: true,
    },
    {
      id: 'a9',
      severity: 'medium' as const,
      title: 'D.W. Prouty Co. — $6,395',
      description: 'D.W. Prouty sent 3rd request on 2/6/2026 for invoice DWP/2025/02733 ($6,394.56 due 11/28/2025): \'We have made several attempts to obtain payment with no response or answered messages. Your account is on Credit Hold.\' Lyn Smith followed up again on 2/',
      timestamp: Date.now() - 3110400000,
      actionable: true,
    },
    {
      id: 'a10',
      severity: 'medium' as const,
      title: 'Sunbelt Rentals — $6,015',
      description: 'Donna Spencer emailed 3/6/2026: \'No payment has been made in 4 months on your account.\' Total past due is $6,095.70 across 6 scaffolding invoices plus late charges dating back to Nov 2025. Late charges now accruing ($33.25 in Jan, $47.49 in Feb). Ear',
      timestamp: Date.now() - 1814400000,
      actionable: true,
    },
    {
      id: 'a11',
      severity: 'medium' as const,
      title: 'Videojet Technologies — $1,830',
      description: 'Smarak Sahoo emailed on 3/17/2026 (subject: \'ACCOUNT ON HOLD\'): Invoice #4440986 ($853.67, due 2/22/2026) now 29 days past terms, plus a new Invoice #4491677 ($381.99). \'Terms on future orders will be impacted by continued delinquency.\' An automated ',
      timestamp: Date.now() - 86400000,
      actionable: true,
    }
  ],
};

export const MOCK_INSPECTOR_DATA = {
  columns: ['Vendor', 'Balance', 'Tier', 'Last Contact', 'Category', 'Status'],
  rows: [
    ['CSX Transportation', '$523,216', 'Monitor', '217d', 'Logistics/Shipping (Rail Freig', 'Active'],
    ['Alabama Power (Southern Company)', '$256,553', 'Monitor', '37d', 'Utility (Electricity) — Operat', 'Active'],
    ['Millard Maritime, LLC', '$226,306', 'Monitor', '—', 'Logistics/Shipping (Maritime)', 'Active'],
    ['AITX (Julie Momany)', '$158,353', 'Monitor', '391d', 'Production Equipment/Technolog', 'Active'],
    ['Mittal Technopack (Aran Group)', '$113,903', 'Monitor', '108d', 'Packaging — Production Critica', 'Active'],
    ['Blake & Pendleton', '$98,188', 'Monitor', '53d', 'Logistics/Shipping; Raw Materi', 'Active'],
    ['Acme-Hardesty', '$81,747', 'Act Now', '22d', 'Raw Materials (Chemicals) — Pr', 'Watch'],
    ['Harry W. Gaffney & Co. (Karen Reese)', '$78,572', 'Monitor', '23d', 'Professional Services (Account', 'Active'],
  ],
};

export const MOCK_BRIEF_DATA = {
  title: 'AP Risk Assessment — INCOA Performance Minerals',
  generatedAt: Date.now(),
  content: `Total accounts payable stands at $2.77M across 191 vendors. Five Tier 1 vendors ($158K) require immediate action:

**Acme-Hardesty ($81,747)**: Payment plan partially working — 1 of 3 installments paid. Collections threat by March 11 if no progress. Raw materials supplier — production critical.

**Vac2Go ($37,220)**: 45 emails over 426 days. Escalated to legal and collections. New CFO Holly Johnson made contact 3/17. Environmental services vendor with equipment on-site.

**Delta Ducon ($27,831)**: Lien filing threatened after 60 days. No INCOA response. Dust collection equipment — production dependency.

**Coverall Service ($7,624)**: Janitorial suspension effective March 31 unless $3,912 paid by March 27. Facility operations at risk.

**McGriff Tire ($3,837)**: Account locked to credit purchases. Safety/regulatory equipment supplier.

Tier 3 contains the largest dollar exposure ($1.83M) led by CSX Transportation ($523K — rail freight, no payments in 90 days) and Alabama Power ($257K — $100K reconnect deposit risk).`,
  confidence: 0.95,
  sources: ['QuickBooks AP Aging (3/26/2026)', 'Vendor Email Analysis', 'Payment History Cross-Reference'],
};

export const MOCK_TIMELINE_DATA = {
  events: [
    { id: 't1', timestamp: Date.now() - 86400000, type: 'system', content: 'Coverall Service suspension deadline: March 27 — $3,912 payment required' },
    { id: 't2', timestamp: Date.now() - 864000000, type: 'user', content: 'CFO Holly Johnson contacted Vac2Go (Don Pulford) — first response in 426 days' },
    { id: 't3', timestamp: Date.now() - 1468800000, type: 'system', content: 'Delta Ducon lien filing warning: 60-day threshold approaching on Invoice 4839' },
    { id: 't4', timestamp: Date.now() - 1900800000, type: 'ai', content: 'Acme-Hardesty collections deadline passed (March 11) — 1 of 3 installments paid, 2 remaining' },
    { id: 't5', timestamp: Date.now() - 5184000000, type: 'system', content: 'Alabama Power disconnect risk: $100K reconnect deposit if any payment missed' },
    { id: 't6', timestamp: Date.now() - 7776000000, type: 'ai', content: 'CSX Transportation identified as largest unpaid vendor — $523K with $0 paid in 90 days' },
  ],
};

export const MOCK_DOCUMENT_DATA = {
  fileName: 'INCOA AP Vendor Tracker v14.xlsx',
  summary: 'Consolidated view of all outstanding vendor payables for INCOA Performance Minerals, reconciled against QuickBooks aging and vendor email communications. Total AP of $2.77M across 191 vendors with 5 Tier 1 urgent vendors requiring immediate action totaling $158K.',
  paragraphs: [
    'The INCOA AP Vendor Tracker v14 (as of March 27, 2026) provides a consolidated view of all outstanding vendor payables, reconciled against QuickBooks aging and vendor email communications. Designed for CFO-level triage of vendor risk, payment prioritization, and operational exposure.',
    'Total AP owed (excluding Belfond) is $2,770,713 across 191 vendors. Tier 1 (Act Now) contains 5 vendors totaling $158,259 with active legal threats, lien filings, or service suspensions. Tier 2 (Unblock) has 6 vendors at $152,291 with credit holds blocking operations.',
    'Tier 3 (Monitor) represents the largest dollar exposure at $1,834,096 across 19 vendors. CSX Transportation leads at $523,216 with no payments made in 90 days despite being the single largest vendor. Alabama Power at $256,553 carries a $100,000 reconnect deposit risk if payments are missed.',
    'Tier 4 (Pay Later) contains 161 vendors totaling $626,067. These vendors have lower urgency but include some with growing balances, such as Seasons Transport ($61,422) and Chicago Freight Car ($46,780).',
    'Key escalation patterns across all tiers include legal action threats, lien filings, service termination notices, collections referrals, and credit holds/COD requirements. Multiple vendors have received zero responses from INCOA despite repeated outreach.',
    'Data sources include QuickBooks AP Aging Report (3/26/2026), AI-assisted analysis of vendor email communications, and payment history cross-referencing for reconciliation. Amounts flagged "REVIEW" require manual verification.',
  ],
};

export const MOCK_DATASET_DATA = {
  columns: ['Vendor', 'Priority Tier', 'Balance', 'Days Silent', 'Emails', 'Risk Category', 'Contact'],
  rows: [
    ['CSX Transportation', 'Tier 3 — Monitor', '$523,216', '217', '14', 'Logistics/Shipping (Rail Freight) — Oper', 'CSXT_CashApp; Cabay, Brad; Daniell, Rachel'],
    ['Alabama Power (Southern Company)', 'Tier 3 — Monitor', '$256,553', '37', '43', 'Utility (Electricity) — Operations Criti', 'G2alabamapps@southernco.com'],
    ['Millard Maritime, LLC', 'Tier 3 — Monitor', '$226,306', '—', '3', 'Logistics/Shipping (Maritime)', 'Millard Maritime, LLC'],
    ['AITX (Julie Momany)', 'Tier 3 — Monitor', '$158,353', '391', '1', 'Production Equipment/Technology', 'Julie Momany'],
    ['Mittal Technopack (Aran Group)', 'Tier 3 — Monitor', '$113,903', '108', '20', 'Packaging — Production Critical', 'MTPL-Export; anupammitra@aran-group.com'],
    ['Blake & Pendleton', 'Tier 3 — Monitor', '$98,188', '53', '15', 'Logistics/Shipping; Raw Materials', 'Blake & Pendleton Accounts Receivable'],
    ['Acme-Hardesty', 'Tier 1 — Act Now', '$81,747', '22', '24', 'Raw Materials (Chemicals) — Production C', 'Nancy Rodriguez'],
    ['Harry W. Gaffney & Co. (Karen Reese)', 'Tier 3 — Monitor', '$78,572', '23', '3', 'Professional Services (Accounting/Audit)', 'Karen Reese'],
    ['J.M. Tank Lines', 'Tier 3 — Monitor', '$77,957', '79', '1', 'Logistics/Shipping; Raw Materials', 'Lauren Jackson'],
    ['Christian Pfeiffer (Ruth Schulte)', 'Tier 3 — Monitor', '$67,228', '—', '1', 'Production Equipment (Classification) — ', 'Schulte,Ruth'],
    ['Mondi Group', 'Tier 3 — Monitor', '$67,202', '181', '1', 'Packaging — Production Critical', 'Vazquez Judy (US, Romeoville)'],
    ['Sheppard SVS', 'Tier 3 — Monitor', '$65,286', '256', '4', 'Production Equipment (Motors) — Producti', 'Accounting'],
    ['Seasons Transport (Cindy Williamson)', 'Tier 4 — Pay Later', '$61,422', '193', '6', 'Logistics/Shipping', 'Cindy'],
    ['White Oak Logistics', 'Tier 2 — Unblock', '$52,520', '4', '40', 'Logistics/Shipping; Safety/Regulatory; U', 'Luke Hughes'],
    ['Power & Rubber Supply (Carrie Fendley)', 'Tier 2 — Unblock', '$50,953', '3', '7', 'Logistics/Shipping; Production Equipment', 'Carrie Fendley'],
    ['Chicago Freight Car', 'Tier 4 — Pay Later', '$46,780', '192', '11', 'Logistics/Shipping (Rail Car Leasing)', 'Niaya Ellis'],
    ['Adriana Emmett (company TBD)', 'Tier 4 — Pay Later', '$46,728', '156', '3', 'Logistics/Shipping; Raw Materials; Safet', 'Adriana Emmett'],
    ['Ranger Environmental Services (Tonya Portie)', 'Tier 4 — Pay Later', '$45,092', '134', '5', 'Environmental Services', 'Tonya Portie'],
    ['Zudak Solutions (Carlos Charry)', 'Tier 4 — Pay Later', '$44,986', '53', '9', 'IT/Technology Services', 'Carlos Charry'],
    ['Zudak Solutions LLC', 'Tier 4 — Pay Later', '$44,986', '—', '1', 'Raw Materials; Utility/Operations', 'Zudak Solutions LLC'],
    ['Spire Energy (Gas)', 'Tier 3 — Monitor', '$44,711', '18', '4', 'Utility (Natural Gas) — Operations Criti', 'no-reply@spireenergy.com'],
    ['Cross Country Heating & Cooling', 'Tier 4 — Pay Later', '$38,792', '114', '25', '—', 'Cross Country Heating & Cooling, inc via FreshBooks'],
    ['Vac2Go', 'Tier 1 — Act Now', '$37,220', '10', '45', 'Environmental Services (Vacuum/Cleanup)', 'Don Pulford'],
    ['Bush & Wilton Inc. (Jametta Polk)', 'Tier 4 — Pay Later', '$36,565', '42', '1', 'Industrial Supplies', 'Jametta Polk'],
    ['EquipmentShare', 'Tier 2 — Unblock', '$34,579', '23', '55', 'Equipment Rental — Operations', 'billingreminder@equipmentshare.com'],
    ['Delta Ducon LLC (Natalie Newnom)', 'Tier 1 — Act Now', '$27,831', '17', '3', 'Production Equipment (Dust Collection)', 'Natalie Newnom'],
    ['G.T. Michelli Co.', 'Tier 4 — Pay Later', '$26,544', '39', '21', 'Raw Materials; Safety/Regulatory', 'NetSuite Replies (netsuitereplies@michelli.com)'],
    ['United Rentals', 'Tier 3 — Monitor', '$23,077', '96', '3', 'Equipment Rental — Operations', 'Von Mangornong (UNITED RENTALS); uraccountsreceivable'],
    ['HEPACO / Clean Harbors (Munnawar Mohammed)', 'Tier 4 — Pay Later', '$22,950', '15', '2', 'Raw Materials; Safety/Regulatory; Utilit', 'Mohammed, Munnawar'],
    ['Sterling Systems & Controls (Jackie Davis)', 'Tier 4 — Pay Later', '$15,692', '35', '5', 'Raw Materials; Safety/Regulatory', 'Jackie Davis - Sterling Systems & Controls Inc'],
  ],
};

export const DEFAULT_SUGGESTIONS = [
  { id: 's1', label: 'Show AP exposure', query: 'show me total AP exposure', priority: 1 },
  { id: 's2', label: 'What needs action?', query: 'what vendors need immediate action?', priority: 2 },
  { id: 's3', label: 'Open vendor dataset', query: 'show the full vendor dataset', priority: 3 },
];
