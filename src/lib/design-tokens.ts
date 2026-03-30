/**
 * Design Tokens — single source of truth for the workspace design system.
 *
 * Philosophy (borrowed from Solar Insight):
 * - Object type colors are IDENTITY — never used for status
 * - Status colors are SEVERITY — never used for identity
 * - Brand accent is UI CHROME — CTAs, active states, Sherpa branding
 * - Never mix these three categories
 */

export const tokens = {
  // Object type identity colors (NEVER for status)
  objectTypes: {
    metric:              { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: '📊', label: 'Metric' },
    comparison:          { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', icon: '⇄', label: 'Comparison' },
    alert:               { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', icon: '⚠', label: 'Alert' },
    inspector:           { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200', icon: '🔍', label: 'Inspector' },
    brief:               { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: '📋', label: 'Brief' },
    timeline:            { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', icon: '◷', label: 'Timeline' },
    monitor:             { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', icon: '◉', label: 'Monitor' },
    document:            { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: '📄', label: 'Document' },
    dataset:             { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', icon: '⊞', label: 'Dataset' },
    analysis:            { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', icon: '✦', label: 'Analysis' },
    'action-queue':      { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', icon: '☐', label: 'Action Queue' },
    'vendor-dossier':    { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', icon: '◈', label: 'Dossier' },
    'cash-planner':      { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', icon: '$', label: 'Cash Planner' },
    'escalation-tracker':{ bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: '↗', label: 'Escalation' },
    'outreach-tracker':  { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', icon: '✉', label: 'Outreach' },
    'production-risk':   { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', icon: '⚙', label: 'Production Risk' },
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

  // Spring easings (also registered in Tailwind as ease-spring-bounce / ease-spring-smooth)
  easing: {
    bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
    standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },

  // Shadows at 3 elevation levels
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
