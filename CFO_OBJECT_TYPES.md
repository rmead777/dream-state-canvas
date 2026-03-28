# CFO Object Types — Implementation Specification

## Context for Claude Code

Dream State Canvas currently has 9 object types: metric, comparison, alert, inspector, brief, timeline, monitor, document, dataset. These are general-purpose analytical primitives. This spec adds 6 new object types designed specifically for a CFO managing vendor payables during a cash crisis.

The user is Holly Johnson, new CFO at INCOA Performance Minerals. She inherited $4.15M in AP aging across 191 vendors, 5 of whom are threatening legal action this week, 6 more with active credit holds blocking operations. She needs to triage, act, and rebuild vendor trust. These objects are what she opens every morning.

**Design philosophy:** The existing objects answer "what's the data?" These new objects answer "what do I DO?" Every one of these should be actionable, not just informational. If Holly can't pick up the phone or authorize a payment directly from looking at the object, it's not done.

**Important:** These objects should be generated dynamically from the DataProfile + dataset + uploaded documents. They are NOT hardcoded seed data. The AI synthesizes them from whatever data is loaded. The seed data examples below are for INCOA but the object types themselves must work for any dataset where the DataProfile identifies priority tiers, urgency signals, and entity relationships.

---

## CRITICAL: Intent Architecture — AI-First, No Keyword Matching

**All object materialization decisions are made by the AI via `parseIntentAI`.** The AI reads the user's natural language query, the workspace state, and the available object types, then decides what to create.

**There is NO keyword fallback for these new object types.** Keyword matching is an anti-pattern in an intent manifestation engine because it cannot understand negation, context, or nuance. "Stop showing me risk tables" and "Show me risk tables" both match the keyword "risk" — and the keyword engine creates a risk table in both cases. This is worse than doing nothing. A wrong materialization destroys user trust.

**The existing keyword engine (`parseIntent` in `intent-engine.ts`) should be deprecated over time.** For now, do NOT add any new keyword patterns for these 6 object types. The AI handles them exclusively.

**If the AI gateway is unavailable:**
1. Sherpa displays: "AI is temporarily unavailable. I can still show you pre-built object types."
2. A catalog grid of available object types appears (visual cards, not text), each with a name, icon, and one-line description.
3. The user clicks the card they want. No interpretation, no guessing, just explicit selection.
4. This is implemented as a fallback UI component (`OfflineCatalog.tsx`), NOT as a keyword parser.

**How the AI learns about these new object types:**
The `intent` mode system prompt in `ai-chat/index.ts` is updated to include the new types in its schema. Example queries are provided as guidance (not as matching rules) so the AI understands when each type is appropriate:

```
Available object types include:
...existing types...
- "action-queue": A sequenced, prioritized to-do list for the CFO. Appropriate when the user 
  asks what to do, what's urgent, what calls to make, how to prioritize their day, or needs 
  a task list. NOT appropriate when they're asking about data or analysis.
- "vendor-dossier": A call-prep briefing for a single vendor. Appropriate when the user asks 
  about a specific vendor by name, wants to prepare for a call, or clicks a vendor name in 
  another object. Requires a vendor name — ask if not provided.
- "cash-planner": An interactive cash allocation optimizer. Appropriate when the user mentions 
  available cash, asks how to allocate payments, or wants to optimize spending.
- "escalation-tracker": Vendor trajectory monitoring. Appropriate when the user asks what's 
  getting worse, wants to see trends, or asks about escalation patterns.
- "outreach-tracker": Communication and promise tracking. Appropriate when the user asks about 
  follow-ups, commitments, communication gaps, or what they've promised vendors.
- "production-risk": Operational dependency mapping. Appropriate when the user asks about 
  production impact, supply chain risk, or what breaks if vendors cut off supply.

The AI decides which type to create based on semantic understanding of the user's intent, 
workspace context, and what objects already exist. It should NEVER create an object that 
contradicts the user's request (e.g., creating a risk panel when the user said to stop showing risks).
```

---

## Existing Architecture (read before implementing)

- Object types are registered in `src/lib/workspace-types.ts` (the `ObjectType` union)
- Object rendering is dispatched in `src/components/workspace/WorkspaceObject.tsx` (the `ObjectContent` switch)
- Object data is generated in `src/lib/intent-engine.ts` (the `getDynamicData` function + seed fallbacks)
- Data slicing uses `src/lib/data-slicer.ts` which consumes the `DataProfile` from `src/lib/data-analyzer.ts`
- AI synthesis calls go through `src/hooks/useAI.ts` → `supabase/functions/ai-chat/index.ts`
- Intent parsing is AI-first via `parseIntentAI`. The keyword fallback `parseIntent` is legacy and should NOT be extended.

---

## New Object Types

### 1. Action Queue (`action-queue`)

**Purpose:** Sequenced, prioritized to-do list. Not "here are the problems" but "here's what to do, in what order, today."

**When the AI should materialize this:**
- User asks what to do, what's urgent, what calls to make, how to prioritize their day
- User wants a task list, an action plan, or next steps
- Sherpa proactively suggests on session start or after new data upload
- Examples: "what should I do today", "what's my action list", "prioritize my week", "who do I call first"

**When the AI should NOT materialize this:**
- User asks about data, analysis, or trends (use metric, brief, or dataset instead)
- User says "stop showing me actions" or similar dismissals
- An action queue already exists and the user hasn't asked for a new one

**Data generation approach:**
1. Pull all Tier 1 and Tier 2 rows from the dataset via DataProfile
2. Sort Tier 1 by deadline proximity (Days Silent ascending = most overdue first), then by operational impact
3. Sort Tier 2 by minimum-payment-to-unblock potential (smallest balance first = quickest win)
4. For each item, extract: vendor name, balance, contact, risk category, and the specific threat/deadline
5. If uploaded documents exist (PDF report), use AI to enrich each action with context from the report narrative
6. Group into time buckets: TODAY, THIS WEEK, NEXT WEEK

**Data schema:**
```typescript
interface ActionQueueData {
  generatedAt: string;
  timeHorizon: string; // "This Week (March 27-31)"
  buckets: ActionBucket[];
  summary: string; // "5 calls, 3 payments, 2 follow-ups"
  totalActionableAmount: number; // sum of amounts needed for all actions
}

interface ActionBucket {
  label: string; // "TODAY", "THIS WEEK", "NEXT WEEK"
  urgency: 'immediate' | 'this-week' | 'next-week';
  actions: ActionItem[];
}

interface ActionItem {
  id: string;
  vendor: string;
  amount: number;
  amountFormatted: string;
  actionType: 'call' | 'pay' | 'follow-up' | 'negotiate' | 'verify';
  description: string; // "Pay $3,912 to prevent janitorial suspension"
  contact: string;
  contactEmail?: string;
  goal: string; // "Restore janitorial services"
  deadline?: string; // "March 27" or null
  deadlinePassed: boolean;
  tier: string; // "Tier 1 — Act Now"
  riskCategory: string;
  isQuickWin: boolean; // balance < $10K and single action clears the hold
  completed: boolean; // user can check off (persisted in object context)
}
```

**Component:** `src/components/objects/ActionQueue.tsx`

**Rendering:**
- Group by time bucket with clear visual separation
- Each action item is a card with: checkbox (completable), vendor name + amount, action description, contact info (clickable email), goal statement
- Quick wins get a subtle badge: "Quick Win — $3,837 clears the hold"
- Completed items stay visible but dimmed with strikethrough
- Deadline-passed items get a red indicator
- Bottom summary: "X of Y actions completed. $Z allocated of $W needed."

**Completion persistence:** When the user checks off an action, store the completion state in the object's context. This persists across sessions via workspace persistence.

**AI enrichment prompt (for `ai-chat` edge function, new mode `action-queue`):**
```
You are generating a prioritized action queue for a CFO managing vendor payables.

Given this dataset of vendors with priority tiers, balances, days silent, and risk categories,
generate a sequenced action list grouped by urgency.

RULES:
1. TODAY bucket: any vendor where a deadline has passed or passes within 48 hours.
   Also include any vendor where the balance is under $5K and a single payment clears a credit hold (quick wins).
2. THIS WEEK bucket: remaining Tier 1 vendors + Tier 2 vendors where the credit hold is blocking
   production-critical supply.
3. NEXT WEEK bucket: remaining Tier 2 vendors + any Tier 3 vendors showing early escalation signals.
4. For each action, specify: the EXACT action (call/pay/follow-up/negotiate/verify),
   the contact person and email, the specific dollar amount, and the goal (what changes if this action is taken).
5. Sequence within each bucket by operational impact, not dollar amount.
   A $3,837 payment that unblocks tire purchases is more urgent than a $52K negotiation.
6. Mark items as "quick win" if balance < $10K and a single payment resolves the hold/threat.

Return JSON matching the ActionQueueData schema.
```

---

### 2. Vendor Dossier (`vendor-dossier`)

**Purpose:** One-page call prep briefing for a specific vendor. Everything Holly needs before picking up the phone.

**When the AI should materialize this:**
- User clicks a vendor name in any other object (table row, alert, action queue item)
- User asks about a specific vendor by name
- User wants to prepare for a vendor call or understand a vendor's situation
- Examples: "tell me about Acme-Hardesty", "prepare me for the Vac2Go call", "what's the story with Delta Ducon"

**When the AI should NOT materialize this:**
- User asks a general question that doesn't reference a specific vendor
- User asks for comparison between vendors (use comparison type instead)

**Data generation approach:**
1. Find the vendor row in the dataset
2. Pull all context: balance, tier, days silent, emails, risk category, contact
3. If uploaded documents exist, use AI to extract the vendor's full narrative from the report (threat history, payment history, relationship context, what they want)
4. Structure into a call-prep format: situation, history, what they want, what we can offer, risk if ignored

**Data schema:**
```typescript
interface VendorDossierData {
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

  // AI-enriched from documents
  situation: string; // 1-2 sentence current state
  threatType?: string; // "Legal + Collections", "Credit Hold", "Service Suspension", etc.
  threatTimeline?: string; // "Deadline passed 3/11" or "Lien filing in ~5 days"
  relationshipHistory: string[]; // bullet points of key events
  whatTheyWant: string; // "Communication + resumed payments"
  whatWeCanOffer: string; // placeholder or AI-suggested based on tier
  leverage: string; // "We need their chemicals. They know it."
  riskIfIgnored: string; // "Legal action + new orders blocked"
  paymentHistory?: string; // "Paid $40,873 on 2/24. Prior: December 2025 cycle."
  keyQuotes?: string[]; // exact vendor language from emails (if available from report)

  sources: string[]; // attribution
}
```

**Component:** `src/components/objects/VendorDossier.tsx`

**Rendering:**
- Header: vendor name, tier badge (colored), balance large, contact info with clickable email
- Situation block: bold, prominent — this is the first thing Holly reads
- Threat indicator: type + timeline with visual urgency
- Relationship history: compact timeline of key events
- "What they want / What we can offer / Leverage / Risk" grid — 2x2 layout
- Payment history at bottom
- Key quotes (if available) in subtle callout blocks
- "← prepared from [sources]" attribution at bottom

**Trigger from other objects:** When any table, alert, or action queue item contains a vendor name, that name should be clickable. Clicking materializes a vendor dossier for that vendor. Implementation: add an `onVendorClick` prop pattern that fires `processIntent("vendor dossier for [name]")`.

**AI enrichment prompt (mode: `vendor-dossier`):**
```
You are preparing a call briefing for a CFO about to contact a specific vendor.

Vendor data from the dataset: [row data]
Document context (if available): [relevant sections from uploaded report]

Generate a dossier that answers:
1. SITUATION: What is the current state in 1-2 sentences?
2. THREAT TYPE: What specific threat is active? (legal, lien, credit hold, suspension, repossession, none)
3. THREAT TIMELINE: How urgent? Days until next escalation?
4. RELATIONSHIP HISTORY: 3-5 key events in chronological order
5. WHAT THEY WANT: What would resolve this from the vendor's perspective?
6. LEVERAGE: What leverage does INCOA have? (do we need their product? are they replaceable?)
7. RISK IF IGNORED: What happens if we do nothing for 30 more days?
8. PAYMENT HISTORY: Recent payments made, if any

Be specific. Use exact dollar amounts, dates, and names. No generic language.
Return JSON matching the VendorDossierData schema.
```

---

### 3. Cash Allocation Planner (`cash-planner`)

**Purpose:** Interactive tool that takes available cash as input and outputs an optimized spending plan. Not "here's what we owe" but "here's how to spend $X for maximum impact."

**When the AI should materialize this:**
- User mentions available cash, a budget, or asks how to allocate payments
- User wants to optimize spending or plan a payment run
- Examples: "I have $50K to allocate", "how should I spend this cash", "plan my payments", "what if I have $100K"

**Data generation approach:**
1. Pull all Tier 1 and Tier 2 vendors with their balances and minimum-to-unblock amounts
2. Compute "operational value per dollar" — a $3,837 payment that unblocks tire purchases has higher value-per-dollar than a $81K payment that partially reduces a legal threat
3. Generate a ranked allocation list optimized for: (a) quick wins first (small payments that fully clear holds), (b) production-critical unblocks second, (c) legal risk mitigation third
4. When user enters an amount, filter the list to fit within budget

**Data schema:**
```typescript
interface CashPlannerData {
  availableCash: number | null; // null = user hasn't entered yet
  allocations: CashAllocation[];
  summary: {
    totalNeeded: number; // to clear all Tier 1 + 2
    quickWinsTotal: number; // sum of items < $10K that fully clear
    quickWinsCount: number;
    vendorsUnblocked: number; // count of vendors fully resolved
    operationalImpact: string; // "4 credit holds cleared, 1 lien prevented"
  };
  unallocated: CashAllocation[]; // items that didn't fit in the budget
}

interface CashAllocation {
  vendor: string;
  tier: string;
  fullBalance: number;
  recommendedPayment: number; // may be less than full balance (minimum to unblock)
  isMinimumPayment: boolean; // true if recommended < full balance
  priority: number; // 1 = highest
  rationale: string; // "Clears credit hold. Restores tire purchases."
  category: 'quick-win' | 'production-critical' | 'legal-mitigation' | 'relationship';
  operationalImpact: string; // "Tire purchases resume"
  isFullyResolved: boolean; // true if this payment clears the entire issue
}
```

**Component:** `src/components/objects/CashPlanner.tsx`

**Rendering:**
- Top: large input field with dollar formatting — "Available cash: $________"
- When no amount entered: show full allocation list with running total, dimmed
- When amount entered: highlight allocated items (green), dim unaffordable items, show running balance
- Each allocation row: priority number, vendor name, recommended payment (bold), rationale, category badge
- Running total bar at bottom: "$X of $Y allocated. Z vendors resolved."
- Quick wins section highlighted: "Pay $15,974 to unblock 4 vendors"
- "What this buys" summary paragraph at bottom

**Interactivity:**
- User can adjust individual allocation amounts (slider or input)
- User can skip items (checkbox to exclude)
- Totals recalculate live
- "Reset to recommended" button

**AI enrichment prompt (mode: `cash-planner`):**
```
You are a cash allocation optimizer for a CFO with limited funds.

Dataset: [Tier 1 and Tier 2 vendors with balances and risk categories]
Available cash: $[amount] (or "not yet specified" if null)

Generate an optimal allocation plan following these rules:
1. Quick wins FIRST: payments under $10K that fully clear a credit hold, account lock, or service suspension.
   These have the highest operational-value-per-dollar.
2. Production-critical SECOND: vendors whose hold directly blocks raw materials, equipment, or production.
3. Legal mitigation THIRD: vendors threatening liens, lawsuits, or collections.
4. For large balances (>$25K), determine the MINIMUM payment that would de-escalate
   (e.g., "one installment of $12,407 buys 30 days of goodwill with Vac2Go").
5. Always recommend the minimum effective payment, not the full balance,
   unless the full balance IS the minimum (e.g., Coverall's $3,912).
6. For each allocation, state the specific operational outcome: what changes tomorrow if this payment is made?

Return JSON matching the CashPlannerData schema.
```

---

### 4. Escalation Tracker (`escalation-tracker`)

**Purpose:** Trajectory monitoring. Not "what's the current state" but "where is each vendor HEADING?" Shows escalation velocity and direction.

**When the AI should materialize this:**
- User asks about trends, trajectories, what's getting worse or better
- User wants to understand vendor momentum, not just current state
- Examples: "which vendors are getting worse", "show me escalation trends", "who's accelerating", "what's the trajectory"

**Data generation approach:**
1. Pull all vendors with Tier 1, 2, and 3 status
2. Use Days Silent + Email Count + Tier to infer trajectory:
   - ACCELERATING: Tier 1 vendors where days silent is low (recent contact = active escalation) or where deadlines have passed
   - STABILIZING: Vendors where Holly has made contact (detectable from report context or very recent email dates)
   - STATIC: Tier 3 vendors with high days silent (quiet but large balances)
   - DE-ESCALATING: Vendors with low current balances that previously had higher tiers or threats (detectable from payment history in report)
3. AI enriches with document context to identify the specific escalation path per vendor

**Data schema:**
```typescript
interface EscalationTrackerData {
  categories: EscalationCategory[];
  summary: string; // "2 accelerating, 2 stabilizing, 6 static, 4 de-escalated"
  worstCase: string; // "Delta Ducon lien filing is the most imminent threat"
}

interface EscalationCategory {
  label: 'accelerating' | 'stabilizing' | 'static' | 'de-escalating';
  icon: string; // ⚠ → ● ✓
  description: string; // "Getting worse — intervention needed"
  vendors: EscalationEntry[];
}

interface EscalationEntry {
  vendor: string;
  balance: number;
  balanceFormatted: string;
  tier: string;
  trajectory: string; // "Inquiry → 3rd Request → Lien Threat → [LIEN FILING next]"
  daysToNextEscalation: number | null; // estimated days until next escalation step, null if unknown
  lastTouch: string; // "3/17 (Holly's intro email)" or "No INCOA response on record"
  riskIfIgnored: string; // "Lien creates legal encumbrance on INCOA assets"
  keyFact: string; // the single most important thing to know
}
```

**Component:** `src/components/objects/EscalationTracker.tsx`

**Rendering:**
- Four sections with distinct visual treatment:
  - ⚠ ACCELERATING: red-tinted background, vendor cards with trajectory arrows showing escalation path
  - → STABILIZING: blue/neutral background, showing Holly's intervention points
  - ● STATIC: gray background, large balances that aren't moving
  - ✓ DE-ESCALATED: green-tinted, resolved or nearly resolved vendors
- Each vendor entry: name, balance, trajectory chain (visual: step → step → step → [NEXT]), days to next escalation, last touch date
- Click any vendor name to materialize a vendor dossier
- Summary bar at top: counts per category with color-coded indicators

**AI enrichment prompt (mode: `escalation-tracker`):**
```
You are analyzing vendor escalation trajectories for a CFO.

Dataset: [vendor data with tiers, balances, days silent, email counts]
Document context: [report narrative sections about vendor histories]

For each vendor in Tiers 1-3, classify their trajectory:
1. ACCELERATING: active escalation in progress. Deadline approaching or passed. Each contact from vendor is more severe than the last.
2. STABILIZING: CFO has made contact, a plan is forming, or a payment was recently made. The vendor's tone has shifted from threatening to negotiating.
3. STATIC: large balance, no recent threats, no recent payments. Dormant but potentially dangerous.
4. DE-ESCALATING: balance declining, previous threats resolved by payment, or current amount is routine.

For ACCELERATING vendors, provide the escalation chain: what happened → what happened → what happens next.
Estimate days to next escalation step based on the threat pattern.

Return JSON matching the EscalationTrackerData schema.
```

---

### 5. Outreach Tracker (`outreach-tracker`)

**Purpose:** Promise and follow-up management. Tracks what Holly has committed to, what vendors are waiting for, and builds her credibility record.

**When the AI should materialize this:**
- User asks about follow-ups, promises, communication gaps, or credibility
- User wants to see what they've committed to and whether they're delivering
- Examples: "what have I promised", "who am I supposed to call back", "show me communication gaps", "am I keeping my commitments"

**Data generation approach:**
1. From dataset: identify vendors with very low Days Silent (Holly recently engaged) vs vendors with high Days Silent (no INCOA response)
2. From document context: extract specific promises, contacts made, and communication gaps mentioned in the report
3. Categorize into: PROMISES MADE (Holly must deliver), NO RESPONSE ON RECORD (vendors waiting), CONTACTS MADE (Holly's track record)

**Data schema:**
```typescript
interface OutreachTrackerData {
  promises: OutreachItem[];
  noResponse: OutreachItem[];
  contactsMade: OutreachItem[];
  summary: {
    totalPromises: number;
    overduePromises: number;
    vendorsWithNoResponse: number;
    contactsMadeCount: number;
  };
  credibilityNote: string; // AI assessment of Holly's communication track record
}

interface OutreachItem {
  vendor: string;
  balance: number;
  balanceFormatted: string;
  date: string; // "3/17/2026" or "N/A"
  description: string; // "Introduced herself, promised response by afternoon"
  status: 'overdue' | 'pending' | 'completed' | 'no-response';
  daysSinceAction: number | null;
  urgency: 'high' | 'medium' | 'low';
  suggestedNextStep: string; // "Follow up on the Ops meeting outcome"
}
```

**Component:** `src/components/objects/OutreachTracker.tsx`

**Rendering:**
- Three sections with distinct treatment:
  - PROMISES MADE: yellow/amber cards. Each shows what was promised, when, and whether it's overdue. Overdue items pulse subtly.
  - NO RESPONSE: red-tinted. Vendors who've emailed INCOA multiple times with zero replies. Shows email count + days waiting. Sorted by email count descending (most neglected first).
  - CONTACTS MADE: green cards. Holly's positive track record. Shows dates and outcomes.
- Each item is actionable: click to open vendor dossier, or click "mark as done" to log the follow-up
- Summary at top: "2 overdue promises, 3 vendors with zero responses, 4 contacts made this week"
- Credibility note at bottom: AI assessment like "Holly has contacted 3 of 5 Tier 1 vendors in her first month. The remaining gaps (Delta Ducon, Coverall) need immediate attention to maintain momentum."

**AI enrichment prompt (mode: `outreach-tracker`):**
```
You are tracking a new CFO's vendor communication for credibility management.

Dataset: [vendor data with days silent and email counts]
Document context: [report sections about Holly's contacts, vendor response gaps, staff changes]

Categorize vendor relationships into three buckets:
1. PROMISES MADE: where the CFO or INCOA committed to something specific (a call, a payment, a timeline).
   Flag as overdue if the promise date has passed with no visible follow-through.
2. NO RESPONSE: vendors who have sent multiple emails to INCOA with ZERO response on record.
   These are credibility-damaging gaps. Prioritize by email count and tier.
3. CONTACTS MADE: positive touches where the CFO has initiated communication.
   These build credibility capital.

For each item, suggest a specific next step.
Provide a credibility assessment: how is the CFO doing at rebuilding vendor trust?

Return JSON matching the OutreachTrackerData schema.
```

---

### 6. Production Risk Map (`production-risk`)

**Purpose:** Cross-reference vendor tiers with operational categories to show supply chain dependencies. Answers: "if we don't pay X, what breaks?"

**When the AI should materialize this:**
- User asks about production impact, supply chain, operational dependencies, or what breaks
- User wants to understand the connection between financial decisions and operational outcomes
- Examples: "what happens if we don't pay", "production risk", "what breaks if vendors cut us off", "supply chain impact"

**Data generation approach:**
1. Pull all Tier 1, 2, and 3 vendors
2. Group by operational category using the Risk Category column from the dataset
3. Map each vendor's hold/threat to its operational consequence
4. Identify production-critical chains: raw materials → processing equipment → logistics → utilities

**Data schema:**
```typescript
interface ProductionRiskData {
  chains: ProductionChain[];
  summary: string; // "3 production-critical vendors blocked. 2 utility relationships at risk."
  worstCase: string; // "If Delta Ducon files a lien and Alabama Power disconnects, the plant cannot operate dust collection or maintain power."
}

interface ProductionChain {
  category: 'critical-path' | 'operational' | 'facility' | 'utility';
  label: string; // "CRITICAL PATH — production stops without these"
  severity: 'red' | 'amber' | 'green' | 'gray';
  vendors: ProductionRiskVendor[];
}

interface ProductionRiskVendor {
  vendor: string;
  balance: number;
  balanceFormatted: string;
  tier: string;
  riskCategory: string;
  status: string; // "BLOCKED", "CREDIT HOLD", "LIEN RISK", "REPO THREAT", "SUSPENDED", "ON HOLD", "PAYING", "STABLE"
  operationalConsequence: string; // "Cannot order raw material chemicals for production"
  minimumToRestore?: number; // minimum payment to restore operations, if known
}
```

**Component:** `src/components/objects/ProductionRiskMap.tsx`

**Rendering:**
- Four severity sections (🔴 🟡 🟢 ⚪), each containing vendor cards grouped by operational function
- Each vendor: name, balance, status badge (colored by threat type), one-line consequence
- Visual hierarchy: the most production-critical (raw materials, equipment, utilities) at top, facility services lower
- Connecting lines or grouped layout showing dependency chains (e.g., "Delta Ducon dust collection → needs power from Alabama Power → shipped via CSX Transportation")
- Worst-case scenario callout at bottom: what happens if all red-zone vendors escalate simultaneously
- Click vendor names to open dossiers

**AI enrichment prompt (mode: `production-risk`):**
```
You are mapping operational dependencies for a manufacturing plant's vendor payables.

Dataset: [vendor data with risk categories and tiers]
Document context: [report sections about vendor roles and operational impact]

Group vendors into four operational chains:
1. CRITICAL PATH (red): vendors whose hold/block directly stops production. Raw materials, production equipment, environmental compliance.
2. OPERATIONAL (amber): vendors whose hold degrades operations but doesn't stop production. Logistics, parts, equipment rental.
3. FACILITY (green): workplace services. Janitorial, office supplies, non-production equipment.
4. UTILITIES (gray): power, gas, water, telecom. Usually actively managed but catastrophic if lost.

For each vendor, state:
- The SPECIFIC operational consequence if they cut off supply
- The current status of their hold/threat
- The minimum payment that would restore operations (if determinable)

Generate a worst-case scenario: what happens if all critical-path vendors escalate simultaneously?

Return JSON matching the ProductionRiskData schema.
```

---

## Implementation Plan

### Step 1: Type Registration

**`src/lib/workspace-types.ts`:**
Add to `ObjectType` union:
```typescript
export type ObjectType = 
  'metric' | 'comparison' | 'alert' | 'inspector' | 'brief' | 'timeline' | 
  'monitor' | 'document' | 'dataset' |
  'action-queue' | 'vendor-dossier' | 'cash-planner' | 
  'escalation-tracker' | 'outreach-tracker' | 'production-risk';
```

### Step 2: Component Creation

Create 6 new files in `src/components/objects/`:
- `ActionQueue.tsx`
- `VendorDossier.tsx`
- `CashPlanner.tsx`
- `EscalationTracker.tsx`
- `OutreachTracker.tsx`
- `ProductionRiskMap.tsx`

### Step 3: Type Definitions

Create `src/lib/cfo-object-types.ts` with all the interfaces defined above.

### Step 4: Rendering Registration

**`src/components/workspace/WorkspaceObject.tsx`:**
Add imports and cases to the `ObjectContent` switch:
```typescript
case 'action-queue': return <ActionQueue object={object} />;
case 'vendor-dossier': return <VendorDossier object={object} />;
case 'cash-planner': return <CashPlanner object={object} />;
case 'escalation-tracker': return <EscalationTracker object={object} />;
case 'outreach-tracker': return <OutreachTracker object={object} />;
case 'production-risk': return <ProductionRiskMap object={object} />;
```

Add labels to `typeLabels`:
```typescript
'action-queue': 'Action Queue',
'vendor-dossier': 'Dossier',
'cash-planner': 'Cash Planner',
'escalation-tracker': 'Escalation',
'outreach-tracker': 'Outreach',
'production-risk': 'Production Risk',
```

### Step 5: Data Generation

**`src/lib/data-slicer.ts`:** Add new slicer functions:
- `actionQueueItems(columns, rows, profile)` — returns Tier 1+2 vendors sequenced by urgency
- `vendorDossierData(columns, rows, profile, vendorName)` — returns single vendor's full data
- `cashAllocationPlan(columns, rows, profile, availableCash?)` — returns prioritized allocation
- `escalationEntries(columns, rows, profile)` — returns vendors categorized by trajectory
- `outreachStatus(columns, rows, profile)` — returns communication gap analysis
- `productionRiskChains(columns, rows, profile)` — returns operational dependency groups

These are pure functions consuming the DataProfile. They handle the data extraction. AI enrichment happens in the intent engine or in the component via `callAI`.

### Step 6: AI Intent Integration (NO keyword patterns)

**`supabase/functions/ai-chat/index.ts`:**

Update the `intent` mode system prompt to include the 6 new object types with semantic descriptions (see the "Intent Architecture" section at the top of this spec). The AI decides which type to create based on understanding, not keyword matching.

Add new system prompt modes for enrichment: `action-queue`, `vendor-dossier`, `cash-planner`, `escalation-tracker`, `outreach-tracker`, `production-risk`. Each uses the AI enrichment prompts defined above.

**`src/lib/intent-engine.ts`:**

Update `getDynamicData` to call the new slicer functions for data-derived types. Do NOT add any new entries to the `patterns` array in `parseIntent`. These object types are AI-only.

**Offline fallback (`src/components/workspace/OfflineCatalog.tsx`):**

Create a visual catalog component that renders when the AI gateway is unavailable. Shows a grid of available object type cards (icon + name + one-line description). User clicks a card to generate that object type using slicer functions only (no AI enrichment). This replaces keyword matching as the degraded-mode experience.

```typescript
// Triggered when parseIntentAI fails and AI gateway is confirmed down
// NOT triggered on individual query failures (those should retry)
function OfflineCatalog({ onSelect }: { onSelect: (type: ObjectType) => void }) {
  const types = [
    { type: 'action-queue', icon: '☐', label: 'Action Queue', desc: 'Prioritized to-do list' },
    { type: 'vendor-dossier', icon: '◈', label: 'Vendor Dossier', desc: 'Call prep for a vendor' },
    { type: 'cash-planner', icon: '$', label: 'Cash Planner', desc: 'Optimize payment allocation' },
    // ... all types including existing ones
  ];
  // Render as clickable cards in a grid
}
```

### Step 7: Cross-Object Navigation

Add vendor name click handling across existing and new objects. When a vendor name appears in any table, alert, action item, or risk entry, it should be clickable and fire:
```typescript
processIntent(`vendor dossier for ${vendorName}`);
```

Implementation: create a reusable `<VendorLink>` component:
```typescript
function VendorLink({ name }: { name: string }) {
  const { processIntent } = useWorkspaceActions();
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        processIntent(`vendor dossier for ${name}`);
      }}
      className="text-workspace-accent hover:underline cursor-pointer font-medium"
    >
      {name}
    </button>
  );
}
```

Use this in: ActionQueue, EscalationTracker, OutreachTracker, ProductionRiskMap, AlertRiskPanel, DataInspector, DatasetView.

### Step 8: Sherpa Suggestions Update

**`src/lib/sherpa-engine.ts`:**
Update `buildDefaultSuggestions` and `buildContextualSuggestions` to include the new object types:

- When dataset is loaded and has urgency signals: suggest "Show my action queue"
- When action queue is open: suggest "Plan cash allocation" and "Check escalation trajectories"
- When user has made contacts (detected from low days-silent): suggest "Track my outreach"
- When multiple Tier 1 vendors are present: suggest "Map production risks"
- After fusion or brief: suggest "Prepare for [top vendor] call" (vendor dossier)

---

## Priority Order for Implementation

| Priority | Object Type | Why First |
|----------|-------------|-----------|
| 1 | `action-queue` | Highest daily usage. This is what Holly opens every morning. |
| 2 | `vendor-dossier` | Highest per-interaction value. Used before every vendor call. |
| 3 | `cash-planner` | Used when cash arrives. Interactive, high decision value. |
| 4 | `escalation-tracker` | Weekly review tool. Board/Adam reporting. |
| 5 | `production-risk` | Weekly review tool. Connects financial to operational. |
| 6 | `outreach-tracker` | Important but lower urgency. Builds over time as Holly makes more contacts. |

Implement 1-2 first and validate with real data before building 3-6. The action queue and vendor dossier together cover 80% of Holly's daily workflow.

---

## Critical Rules

1. **Actions, not information.** Every object must answer "what do I DO?" not just "what is the data?" If the object doesn't have a verb in every entry (call, pay, negotiate, follow up, verify), it's not actionable enough.

2. **Vendor names are always clickable.** Anywhere a vendor name appears in any object, it's a link to that vendor's dossier. This is the primary navigation pattern for CFO workflow.

3. **Dollar amounts are formatted for operators.** $81,747 not $81747. $2.77M not $2,770,713. Use `Intl.NumberFormat`. Apply `tabular-nums`.

4. **Quick wins are highlighted everywhere.** Any payment under $10K that fully clears a vendor's hold gets a "Quick Win" badge. Holly should see these first because they're the highest-ROI actions.

5. **Completion state persists.** When Holly checks off an action in the action queue, it stays checked. This is stored in the object's context and survives session restarts.

6. **All new objects respect the DataProfile.** Sorting, filtering, and tier logic flow through the existing data-analyzer/data-slicer pipeline. The new slicer functions consume the DataProfile just like existing ones. The AI enrichment layer adds narrative context but never overrides the priority structure.

7. **Document context is optional but transformative.** These objects work with just the spreadsheet data (basic mode). When the PDF report is also uploaded, the AI can enrich every object with vendor narratives, payment history context, threat timelines, and the "December 2025 Payment Cliff" backstory. The components should handle both cases gracefully — never crash if document context is missing, but show richer content when it's available.

8. **NO keyword matching. AI-only intent parsing.** These object types are materialized exclusively through AI intent parsing (`parseIntentAI`). Do NOT add keyword patterns to `parseIntent`. If the AI is unavailable, the fallback is an explicit visual catalog (`OfflineCatalog.tsx`) where the user clicks the object type they want — not a keyword interpreter that guesses wrong.
