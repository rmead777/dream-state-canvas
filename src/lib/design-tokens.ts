/**
 * Design Tokens — single source of truth for the workspace design system.
 *
 * Philosophy:
 * - Object type colors are IDENTITY — never used for status
 * - Status colors are SEVERITY — never used for identity
 * - Brand accent is UI CHROME — CTAs, active states, Sherpa branding
 * - Card families group types into visual species
 * - Never mix these three categories
 */

// ─── Card Family Taxonomy ──────────────────────────────────────────────────

export type CardFamily = 'thinking' | 'lens' | 'source' | 'action';

/** Map every object type to its card family */
export const CARD_FAMILY: Record<string, CardFamily> = {
  // THINKING — intelligence objects
  analysis: 'thinking',
  brief: 'thinking',
  'vendor-dossier': 'thinking',
  'cash-planner': 'thinking',
  'escalation-tracker': 'thinking',
  'outreach-tracker': 'thinking',
  'production-risk': 'thinking',
  'action-queue': 'thinking',
  // LENS — data instruments
  inspector: 'lens',
  metric: 'lens',
  comparison: 'lens',
  alert: 'lens',
  timeline: 'lens',
  monitor: 'lens',
  // SOURCE — native source surfaces
  dataset: 'source',
  document: 'source',
  'document-viewer': 'source',
  'dataset-edit-preview': 'source',
  // ACTION — execution objects
  'email-draft': 'action',
  simulation: 'action',
  'calendar-event': 'action',
};

/** Family-level visual tokens — the gradient tint at the top of each card */
export const FAMILY_TOKENS: Record<CardFamily, {
  gradient: string;       // CSS rgba for the top gradient overlay
  pillBg: string;         // Tailwind class for type pill background
  pillText: string;       // Tailwind class for type pill text
  pillBorder: string;     // Tailwind class for type pill border
  collapsedAccent: string; // Tailwind class for collapsed bar icon color
}> = {
  thinking: {
    gradient: 'rgba(147, 51, 234, 0.07)',    // purple tint
    pillBg: 'bg-purple-50',
    pillText: 'text-purple-600',
    pillBorder: 'border-purple-200/60',
    collapsedAccent: 'text-purple-500',
  },
  lens: {
    gradient: 'rgba(59, 130, 246, 0.07)',     // blue tint
    pillBg: 'bg-blue-50',
    pillText: 'text-blue-600',
    pillBorder: 'border-blue-200/60',
    collapsedAccent: 'text-blue-500',
  },
  source: {
    gradient: 'rgba(16, 185, 129, 0.06)',     // emerald tint
    pillBg: 'bg-emerald-50',
    pillText: 'text-emerald-600',
    pillBorder: 'border-emerald-200/60',
    collapsedAccent: 'text-emerald-500',
  },
  action: {
    gradient: 'rgba(249, 115, 22, 0.07)',     // orange tint
    pillBg: 'bg-orange-50',
    pillText: 'text-orange-600',
    pillBorder: 'border-orange-200/60',
    collapsedAccent: 'text-orange-500',
  },
};

export function getCardFamily(type: string): CardFamily {
  return CARD_FAMILY[type] || 'thinking';
}

export function getFamilyTokens(type: string) {
  return FAMILY_TOKENS[getCardFamily(type)];
}

// ─── Per-Type Identity Tokens ──────────────────────────────────────────────

export const tokens = {
  objectTypes: {
    metric:              { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: '📊', label: 'Metric' },
    comparison:          { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', icon: '⇄', label: 'Comparison' },
    alert:               { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', icon: '⚠', label: 'Alert' },
    inspector:           { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200', icon: '🔍', label: 'Data Lens' },
    brief:               { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: '📋', label: 'Brief' },
    timeline:            { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', icon: '◷', label: 'Timeline' },
    monitor:             { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', icon: '◉', label: 'Monitor' },
    document:            { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: '📄', label: 'Source' },
    'document-viewer':   { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: '📄', label: 'Source' },
    dataset:             { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', icon: '⊞', label: 'Source' },
    analysis:            { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', icon: '✦', label: '' },
    'action-queue':      { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', icon: '☐', label: 'Actions' },
    'vendor-dossier':    { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', icon: '◈', label: 'Dossier' },
    'cash-planner':      { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', icon: '$', label: 'Planner' },
    'escalation-tracker':{ bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: '↗', label: 'Tracker' },
    'outreach-tracker':  { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', icon: '✉', label: 'Outreach' },
    'production-risk':   { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', icon: '⚙', label: 'Risk Map' },
    'email-draft':       { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', icon: '✉', label: 'Draft' },
    'simulation':        { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', icon: '◎', label: 'Simulation' },
    'dataset-edit-preview': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: '✏', label: 'Proposed Edit' },
  } as Record<string, { bg: string; text: string; border: string; icon: string; label: string }>,

  // Status/severity colors (NEVER for identity)
  status: {
    critical: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300', dot: 'bg-red-500' },
    warning:  { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300', dot: 'bg-amber-500' },
    info:     { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300', dot: 'bg-blue-500' },
    success:  { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300', dot: 'bg-emerald-500' },
    neutral:  { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300', dot: 'bg-gray-400' },
  },

  // Tier urgency (maps to DataProfile priority tiers)
  tiers: {
    1: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: 'Act Now' },
    2: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'Unblock' },
    3: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', label: 'Monitor' },
    4: { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200', label: 'Watch' },
  } as Record<number, { bg: string; text: string; border: string; label: string }>,

  easing: {
    bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
    standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },

  shadow: {
    sm: '0 4px 12px rgba(15, 23, 42, 0.04)',
    md: '0 14px 30px rgba(15, 23, 42, 0.08)',
    lg: '0 24px 60px rgba(15, 23, 42, 0.12)',
    accent: '0 14px 28px rgba(99, 102, 241, 0.12)',
  },
};

/** Get object type token with fallback for unknown types */
export function getObjectTypeToken(type: string) {
  return tokens.objectTypes[type] || tokens.objectTypes.analysis;
}

/** Get status token */
export function getStatusToken(severity: string) {
  return tokens.status[severity as keyof typeof tokens.status] || tokens.status.neutral;
}

/** Get tier token */
export function getTierToken(tier: number) {
  return tokens.tiers[tier] || tokens.tiers[4];
}

// ─── Posture Derivation (data-driven, not AI-declared) ─────────────────────

export type CardPosture = 'live' | 'source-backed' | 'draft' | 'fused' | 'inferred';

/** Derive a card's posture from its context — never ask the AI to declare this */
export function derivePosture(object: { type: string; context?: Record<string, any>; relationships: string[] }): CardPosture | null {
  if (object.context?.isDatasetEdit) return 'draft';
  if (object.type === 'dataset' || object.type === 'document' || object.type === 'document-viewer') return null; // Sources don't need posture
  if (object.relationships?.length >= 2) return 'fused';
  if (object.context?.sourceDocId) return 'source-backed';
  // Cards that used QB data
  if (object.context?.sections?.some?.((s: any) =>
    typeof s.text === 'string' && (s.text.includes('QB') || s.text.includes('QuickBooks'))
  )) return 'live';
  return null; // Don't show posture if we can't infer it
}

export const POSTURE_LABELS: Record<CardPosture, string> = {
  live: 'Live',
  'source-backed': 'Source-Backed',
  draft: 'Draft',
  fused: 'Fused',
  inferred: 'Inferred',
};
