/**
 * CFO Object Type Interfaces — 6 actionable object types for CFO workflow.
 * These answer "what do I DO?" not just "what is the data?"
 */

// ─── Action Queue ────────────────────────────────────────────────────────────

export interface ActionItem {
  id: string;
  vendor: string;
  amount: number;
  amountFormatted: string;
  actionType: 'call' | 'pay' | 'follow-up' | 'negotiate' | 'verify';
  description: string;
  contact: string;
  contactEmail?: string;
  goal: string;
  deadline?: string;
  deadlinePassed: boolean;
  tier: string;
  riskCategory: string;
  isQuickWin: boolean;
  completed: boolean;
}

export interface ActionBucket {
  label: string;
  urgency: 'immediate' | 'this-week' | 'next-week';
  actions: ActionItem[];
}

export interface ActionQueueData {
  generatedAt: string;
  timeHorizon: string;
  buckets: ActionBucket[];
  summary: string;
  totalActionableAmount: number;
}

// ─── Vendor Dossier ──────────────────────────────────────────────────────────

export interface VendorDossierData {
  vendorName: string;
  tier: string;
  balance: number;
  balanceFormatted: string;
  contact: {
    name: string;
    email?: string;
    phone?: string;
    role?: string;
  };
  riskCategory: string;
  daysSilent: number | null;
  emailCount: number;
  situation: string;
  threatType?: string;
  threatTimeline?: string;
  relationshipHistory: string[];
  whatTheyWant: string;
  whatWeCanOffer: string;
  leverage: string;
  riskIfIgnored: string;
  paymentHistory?: string;
  keyQuotes?: string[];
  sources: string[];
}

// ─── Cash Planner ────────────────────────────────────────────────────────────

export interface CashAllocation {
  vendor: string;
  tier: string;
  fullBalance: number;
  recommendedPayment: number;
  isMinimumPayment: boolean;
  priority: number;
  rationale: string;
  category: 'quick-win' | 'production-critical' | 'legal-mitigation' | 'relationship';
  operationalImpact: string;
  isFullyResolved: boolean;
}

export interface CashPlannerData {
  availableCash: number | null;
  allocations: CashAllocation[];
  summary: {
    totalNeeded: number;
    quickWinsTotal: number;
    quickWinsCount: number;
    vendorsUnblocked: number;
    operationalImpact: string;
  };
  unallocated: CashAllocation[];
}

// ─── Escalation Tracker ──────────────────────────────────────────────────────

export interface EscalationEntry {
  vendor: string;
  balance: number;
  balanceFormatted: string;
  tier: string;
  trajectory: string;
  daysToNextEscalation: number | null;
  lastTouch: string;
  riskIfIgnored: string;
  keyFact: string;
}

export interface EscalationCategory {
  label: 'accelerating' | 'stabilizing' | 'static' | 'de-escalating';
  icon: string;
  description: string;
  vendors: EscalationEntry[];
}

export interface EscalationTrackerData {
  categories: EscalationCategory[];
  summary: string;
  worstCase: string;
}

// ─── Outreach Tracker ────────────────────────────────────────────────────────

export interface OutreachItem {
  vendor: string;
  balance: number;
  balanceFormatted: string;
  date: string;
  description: string;
  status: 'overdue' | 'pending' | 'completed' | 'no-response';
  daysSinceAction: number | null;
  urgency: 'high' | 'medium' | 'low';
  suggestedNextStep: string;
}

export interface OutreachTrackerData {
  promises: OutreachItem[];
  noResponse: OutreachItem[];
  contactsMade: OutreachItem[];
  summary: {
    totalPromises: number;
    overduePromises: number;
    vendorsWithNoResponse: number;
    contactsMadeCount: number;
  };
  credibilityNote: string;
}

// ─── Production Risk Map ─────────────────────────────────────────────────────

export interface ProductionRiskVendor {
  vendor: string;
  balance: number;
  balanceFormatted: string;
  tier: string;
  riskCategory: string;
  status: string;
  operationalConsequence: string;
  minimumToRestore?: number;
}

export interface ProductionChain {
  category: 'critical-path' | 'operational' | 'facility' | 'utility';
  label: string;
  severity: 'red' | 'amber' | 'green' | 'gray';
  vendors: ProductionRiskVendor[];
}

export interface ProductionRiskData {
  chains: ProductionChain[];
  summary: string;
  worstCase: string;
}
