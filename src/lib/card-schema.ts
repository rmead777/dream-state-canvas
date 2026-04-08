/**
 * Card Schema — section types for AI-generated card content.
 *
 * DESIGN PRINCIPLE: The AI is the intelligence layer. This file defines
 * TypeScript types for the renderers and a minimal validateSections()
 * that accepts anything with a `type` field. No Zod, no strict validation,
 * no walls between AI output and the executor.
 *
 * The renderers handle missing/malformed fields gracefully with defaults
 * and optional chaining. If the AI sends a field we don't expect, the
 * renderer ignores it. If it's missing a field, the renderer shows a
 * sensible default. This is the safety net — not a validator.
 */

// ─── Section Types (TypeScript only — no runtime validation) ─────────────────

export interface CardSectionType {
  type: string;
  [key: string]: any;
}

// ─── DataQuery Schema ────────────────────────────────────────────────────────

export type DataQuery = Record<string, any> | undefined;

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate sections — accepts anything with a `type` field.
 * The renderers are the safety net, not this function.
 */
export function validateSections(raw: unknown[]): CardSectionType[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is CardSectionType =>
    s != null && typeof s === 'object' && 'type' in s && typeof (s as any).type === 'string'
  );
}
