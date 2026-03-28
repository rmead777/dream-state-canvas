import { ObjectType } from './workspace-types';

export type SynthesisType = 'direct-extraction' | 'inferred-pattern' | 'speculative-synthesis' | 'low-value';

export const SYNTHESIS_LABELS: Record<SynthesisType, { label: string; color: string }> = {
  'direct-extraction': { label: 'Direct Extraction', color: 'bg-emerald-100 text-emerald-700' },
  'inferred-pattern': { label: 'Inferred Pattern', color: 'bg-blue-100 text-blue-700' },
  'speculative-synthesis': { label: 'Speculative Synthesis', color: 'bg-amber-100 text-amber-700' },
  'low-value': { label: 'Low Value', color: 'bg-neutral-100 text-neutral-500' },
};

// ─── Fusion Governance Matrix ────────────────────────────────────────────────

export type FusionOutputType = ObjectType;

export interface FusionRule {
  a: ObjectType;
  b: ObjectType;
  allow: boolean;
  outputType: FusionOutputType;
  rationale: string;
}

/**
 * Explicit governance rules for fusion pairs.
 * Order doesn't matter — lookup normalizes (a,b) and (b,a).
 */
const FUSION_RULES: FusionRule[] = [
  // High-value fusions
  { a: 'metric', b: 'dataset', allow: true, outputType: 'brief', rationale: 'Explain the metric in the context of the full table' },
  { a: 'metric', b: 'alert', allow: true, outputType: 'brief', rationale: 'Correlate urgency with exposure magnitude' },
  { a: 'metric', b: 'comparison', allow: true, outputType: 'brief', rationale: 'Contextualize comparison within aggregate metrics' },
  { a: 'metric', b: 'inspector', allow: true, outputType: 'brief', rationale: 'Deep dive into what drives the metric' },
  { a: 'dataset', b: 'document', allow: true, outputType: 'brief', rationale: 'Cross-reference narrative + structured data' },
  { a: 'dataset', b: 'alert', allow: true, outputType: 'brief', rationale: 'Turn alerts into causal explanation + next actions' },
  { a: 'dataset', b: 'inspector', allow: true, outputType: 'brief', rationale: 'Detailed analysis of inspected subset within full data' },
  { a: 'alert', b: 'timeline', allow: true, outputType: 'brief', rationale: 'Map urgent items to their activity history' },
  { a: 'alert', b: 'document', allow: true, outputType: 'brief', rationale: 'Ground alerts in source document context' },
  { a: 'comparison', b: 'dataset', allow: true, outputType: 'brief', rationale: 'Expand comparison to broader dataset trends' },
  { a: 'comparison', b: 'timeline', allow: true, outputType: 'brief', rationale: 'Track compared entities over time' },
  { a: 'inspector', b: 'timeline', allow: true, outputType: 'brief', rationale: 'Activity history for top inspected items' },
  { a: 'document', b: 'timeline', allow: true, outputType: 'brief', rationale: 'Map document references to timeline events' },
  { a: 'brief', b: 'dataset', allow: true, outputType: 'brief', rationale: 'Enrich analysis with raw data backing' },
  { a: 'brief', b: 'metric', allow: true, outputType: 'brief', rationale: 'Ground narrative analysis in hard numbers' },
  { a: 'brief', b: 'alert', allow: true, outputType: 'brief', rationale: 'Combine strategic analysis with tactical urgency' },

  // Conditionally allowed (same type — only if different subjects)
  { a: 'metric', b: 'metric', allow: true, outputType: 'comparison', rationale: 'Compare two different metrics side by side' },
  { a: 'inspector', b: 'inspector', allow: true, outputType: 'brief', rationale: 'Cross-reference two data slices' },
  { a: 'document', b: 'document', allow: true, outputType: 'brief', rationale: 'Cross-document analysis (only if different sources)' },
  { a: 'alert', b: 'alert', allow: true, outputType: 'brief', rationale: 'Pattern analysis across alert categories' },

  // Blocked — prevents sludge
  { a: 'brief', b: 'brief', allow: false, outputType: 'brief', rationale: 'Recursive summary sludge — no novel insight possible' },
  { a: 'timeline', b: 'timeline', allow: false, outputType: 'brief', rationale: 'No meaningful synthesis between two timelines' },
  { a: 'comparison', b: 'comparison', allow: false, outputType: 'brief', rationale: 'Meta-comparison adds no value' },
];

// Build lookup map for O(1) access
const ruleMap = new Map<string, FusionRule>();
for (const rule of FUSION_RULES) {
  ruleMap.set(`${rule.a}+${rule.b}`, rule);
  ruleMap.set(`${rule.b}+${rule.a}`, rule);
}

/** Get the fusion rule for a pair. Returns undefined for uncovered pairs. */
export function getFusionRule(typeA: ObjectType, typeB: ObjectType): FusionRule | undefined {
  return ruleMap.get(`${typeA}+${typeB}`);
}

/** Returns true if two object types can be fused. Uncovered pairs default to allowed. */
export function canFuse(typeA: ObjectType, typeB: ObjectType): boolean {
  const rule = getFusionRule(typeA, typeB);
  return rule ? rule.allow : true; // permissive default for uncovered pairs
}

/** Get the expected output type for a fusion pair. Defaults to 'brief'. */
export function getFusionOutputType(typeA: ObjectType, typeB: ObjectType): FusionOutputType {
  const rule = getFusionRule(typeA, typeB);
  return rule?.outputType ?? 'brief';
}
