/**
 * EscalationTracker — shows vendor escalation trajectories grouped by momentum.
 * Categories: accelerating (getting worse), stabilizing, static, de-escalating.
 */
import { WorkspaceObject } from '@/lib/workspace-types';
import type { EscalationTrackerData, EscalationCategory, EscalationEntry } from '@/lib/cfo-object-types';
import { VendorLink, formatCurrency } from '@/components/objects/VendorLink';

interface EscalationTrackerProps {
  object: WorkspaceObject;
}

const CATEGORY_CONFIG: Record<
  string,
  { border: string; bg: string; headerBg: string; badge: string; badgeText: string; icon: string }
> = {
  accelerating: {
    border: 'border-red-200',
    bg: 'bg-red-50/40',
    headerBg: 'bg-red-100/60',
    badge: 'bg-red-100 text-red-700 border border-red-200',
    badgeText: 'ACCELERATING',
    icon: '⚠',
  },
  stabilizing: {
    border: 'border-blue-200',
    bg: 'bg-blue-50/30',
    headerBg: 'bg-blue-100/50',
    badge: 'bg-blue-100 text-blue-700 border border-blue-200',
    badgeText: 'STABILIZING',
    icon: '→',
  },
  static: {
    border: 'border-workspace-border/50',
    bg: 'bg-workspace-surface/20',
    headerBg: 'bg-workspace-surface/40',
    badge: 'bg-gray-100 text-gray-600 border border-gray-200',
    badgeText: 'STATIC',
    icon: '●',
  },
  'de-escalating': {
    border: 'border-emerald-200',
    bg: 'bg-emerald-50/30',
    headerBg: 'bg-emerald-100/50',
    badge: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    badgeText: 'DE-ESCALATING',
    icon: '✓',
  },
};

function VendorCard({ entry, config }: { entry: EscalationEntry; config: typeof CATEGORY_CONFIG[string] }) {
  return (
    <div className={`rounded-lg border ${config.border} ${config.bg} px-4 py-3 space-y-2`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <VendorLink name={entry.vendor} />
          <p className="text-[10px] text-workspace-text-secondary/60 tabular-nums mt-0.5">
            Tier {entry.tier}
          </p>
        </div>
        <span className="text-sm font-bold tabular-nums text-workspace-text whitespace-nowrap">
          {formatCurrency(entry.balance)}
        </span>
      </div>

      {/* Trajectory */}
      <p className="text-xs text-workspace-text-secondary leading-relaxed">
        <span className="font-medium text-workspace-text">Trajectory: </span>
        {entry.trajectory}
      </p>

      {/* Key fact */}
      <p className="text-xs text-workspace-text-secondary/80 leading-relaxed italic">
        {entry.keyFact}
      </p>

      {/* Footer row */}
      <div className="flex items-center justify-between gap-3 pt-0.5 border-t border-workspace-border/20">
        <p className="text-[10px] text-workspace-text-secondary/60">
          Last touch: <span className="tabular-nums">{entry.lastTouch}</span>
        </p>
        {entry.daysToNextEscalation !== null ? (
          <p className="text-[10px] font-medium tabular-nums text-workspace-text-secondary">
            Next escalation: <span className="text-workspace-text">{entry.daysToNextEscalation}d</span>
          </p>
        ) : (
          <p className="text-[10px] text-workspace-text-secondary/50">No escalation date</p>
        )}
      </div>

      {/* Risk */}
      {entry.riskIfIgnored && (
        <p className="text-[10px] text-red-600/80 leading-relaxed">
          Risk if ignored: {entry.riskIfIgnored}
        </p>
      )}
    </div>
  );
}

function CategorySection({ category }: { category: EscalationCategory }) {
  if (!category.vendors || category.vendors.length === 0) return null;

  const config = CATEGORY_CONFIG[category.label] ?? CATEGORY_CONFIG.static;

  return (
    <div className={`rounded-xl border ${config.border} overflow-hidden`}>
      {/* Section header */}
      <div className={`flex items-center justify-between gap-3 px-4 py-2.5 ${config.headerBg} border-b ${config.border}`}>
        <div className="flex items-center gap-2">
          <span className="text-sm">{config.icon}</span>
          <span className={`text-[10px] font-semibold uppercase tracking-[0.15em] px-2 py-0.5 rounded-full ${config.badge}`}>
            {config.badgeText}
          </span>
          <span className="text-[10px] text-workspace-text-secondary/60">
            {category.vendors.length} vendor{category.vendors.length !== 1 ? 's' : ''}
          </span>
        </div>
        {category.description && (
          <p className="text-[10px] text-workspace-text-secondary/70 hidden sm:block max-w-xs text-right">
            {category.description}
          </p>
        )}
      </div>

      {/* Vendor cards */}
      <div className="p-3 space-y-2">
        {category.vendors.map((entry, i) => (
          <VendorCard key={`${entry.vendor}-${i}`} entry={entry} config={config} />
        ))}
      </div>
    </div>
  );
}

export function EscalationTracker({ object }: EscalationTrackerProps) {
  const data = object.context as EscalationTrackerData | undefined;

  if (!data) {
    return (
      <p className="text-sm text-workspace-text-secondary/60">
        No escalation data available.
      </p>
    );
  }

  const categories = data.categories ?? [];
  const activeCategories = categories.filter((c) => c.vendors && c.vendors.length > 0);

  // Summary counts
  const counts = Object.fromEntries(
    categories.map((c) => [c.label, c.vendors?.length ?? 0])
  );

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      {data.summary && (
        <p className="text-sm font-medium text-workspace-text leading-relaxed">
          {data.summary}
        </p>
      )}

      {/* Count pills */}
      {activeCategories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {categories
            .filter((c) => (counts[c.label] ?? 0) > 0)
            .map((c) => {
              const config = CATEGORY_CONFIG[c.label] ?? CATEGORY_CONFIG.static;
              return (
                <span
                  key={c.label}
                  className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] px-2.5 py-1 rounded-full ${config.badge}`}
                >
                  {config.icon} {counts[c.label]} {c.label}
                </span>
              );
            })}
        </div>
      )}

      {/* Category sections */}
      {activeCategories.length === 0 ? (
        <p className="text-sm text-workspace-text-secondary/60">
          No vendors to display.
        </p>
      ) : (
        <div className="space-y-3">
          {activeCategories.map((category) => (
            <CategorySection key={category.label} category={category} />
          ))}
        </div>
      )}

      {/* Worst-case callout */}
      {data.worstCase && (
        <div className="flex items-start gap-2.5 rounded-lg border-l-[3px] border-red-300 bg-red-50/50 px-4 py-3">
          <span className="text-sm mt-0.5 text-red-500">⚡</span>
          <p className="text-xs text-workspace-text leading-relaxed">
            <span className="font-semibold text-red-700">Worst case: </span>
            {data.worstCase}
          </p>
        </div>
      )}
    </div>
  );
}
