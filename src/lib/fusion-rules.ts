import { ObjectType } from './workspace-types';

// Incompatible pairs — these combinations are blocked to prevent clutter
const INCOMPATIBLE_PAIRS: Set<string> = new Set([
  'brief+brief',       // prevents recursive summary sludge
  'timeline+timeline', // no meaningful synthesis
]);

/** Returns true if two object types can be fused */
export function canFuse(typeA: ObjectType, typeB: ObjectType): boolean {
  const key1 = `${typeA}+${typeB}`;
  const key2 = `${typeB}+${typeA}`;
  return !INCOMPATIBLE_PAIRS.has(key1) && !INCOMPATIBLE_PAIRS.has(key2);
}

export type SynthesisType = 'direct-extraction' | 'inferred-pattern' | 'speculative-synthesis' | 'low-value';

export const SYNTHESIS_LABELS: Record<SynthesisType, { label: string; color: string }> = {
  'direct-extraction': { label: 'Direct Extraction', color: 'bg-emerald-100 text-emerald-700' },
  'inferred-pattern': { label: 'Inferred Pattern', color: 'bg-blue-100 text-blue-700' },
  'speculative-synthesis': { label: 'Speculative Synthesis', color: 'bg-amber-100 text-amber-700' },
  'low-value': { label: 'Low Value', color: 'bg-neutral-100 text-neutral-500' },
};
