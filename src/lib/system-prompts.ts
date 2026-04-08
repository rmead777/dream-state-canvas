/**
 * System Prompts — every prompt Sherpa uses, accessible and editable.
 *
 * Prompts are stored in the edge function as defaults.
 * Admin overrides are stored in localStorage and sent to the edge function,
 * which uses them instead of the server defaults when present.
 */

const STORAGE_KEY = 'sherpa-prompt-overrides';

export interface PromptDef {
  id: string;
  label: string;
  description: string;
  category: 'core' | 'enrichment' | 'cfo' | 'utility';
}

/** Registry of all prompt modes the AI uses */
export const PROMPT_REGISTRY: PromptDef[] = [
  // Core
  { id: 'intent', label: 'Intent Parser', description: 'Main query interpreter — decides what action to take', category: 'core' },
  { id: 'morning-brief', label: 'Morning Brief Mode', description: 'The recipe Sherpa runs when the user taps Morning Brief — surveys state, grades predictions, surfaces what matters today', category: 'core' },
  { id: 'update-plan', label: 'Update Planner', description: 'Translates update instructions into structured changes', category: 'core' },
  { id: 'fusion', label: 'Fusion Synthesizer', description: 'Cross-object analysis when two cards are fused', category: 'core' },

  // Data
  { id: 'analyze-schema', label: 'Schema Analyzer', description: 'Analyzes dataset columns to build the DataProfile', category: 'utility' },
  { id: 'refine-profile', label: 'Profile Refiner', description: 'Updates DataProfile based on user feedback', category: 'utility' },

  // Content
  { id: 'document', label: 'Document Analyst', description: 'Answers questions about uploaded documents', category: 'enrichment' },
  { id: 'dataset', label: 'Dataset Analyst', description: 'Generates insights from dataset views', category: 'enrichment' },
  { id: 'brief', label: 'Brief Writer', description: 'Synthesizes context into decision-useful briefs', category: 'enrichment' },
  { id: 'predict', label: 'Predictor', description: 'Predicts what the user needs next', category: 'enrichment' },

  // CFO Object Types
  { id: 'action-queue', label: 'Action Queue Generator', description: 'Sequenced to-do list by urgency', category: 'cfo' },
  { id: 'vendor-dossier', label: 'Vendor Dossier Generator', description: 'Call-prep briefing for one vendor', category: 'cfo' },
  { id: 'cash-planner', label: 'Cash Planner Generator', description: 'Optimal cash allocation plan', category: 'cfo' },
  { id: 'escalation-tracker', label: 'Escalation Tracker Generator', description: 'Vendor trajectory classification', category: 'cfo' },
  { id: 'outreach-tracker', label: 'Outreach Tracker Generator', description: 'Promise and communication tracking', category: 'cfo' },
  { id: 'production-risk', label: 'Production Risk Generator', description: 'Supply chain dependency mapping', category: 'cfo' },
];

// ─── Override Store ──────────────────────────────────────────────────────────

let _overrides: Record<string, string> = {};

try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) _overrides = JSON.parse(stored);
} catch (e) { console.warn('[system-prompts] Failed to load overrides:', e); }

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_overrides));
  } catch (e) { console.warn('[system-prompts] Failed to persist overrides:', e); }
}

/** Get the override for a prompt mode, or null if using server default */
export function getPromptOverride(mode: string): string | null {
  return _overrides[mode] || null;
}

/** Get ALL overrides (for sending to the edge function) */
export function getAllOverrides(): Record<string, string> {
  return { ..._overrides };
}

/** Set an override for a prompt mode */
export function setPromptOverride(mode: string, prompt: string): void {
  _overrides[mode] = prompt;
  persist();
}

/** Remove an override (revert to server default) */
export function clearPromptOverride(mode: string): void {
  delete _overrides[mode];
  persist();
}

/** Check if a mode has a custom override */
export function hasOverride(mode: string): boolean {
  return mode in _overrides;
}

/** Clear all overrides */
export function clearAllOverrides(): void {
  _overrides = {};
  persist();
}
