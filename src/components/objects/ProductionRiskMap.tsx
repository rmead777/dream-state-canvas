/**
 * ProductionRiskMap — renders production risk chains grouped by severity.
 * Severity tiers: critical-path (red), operational (amber), facility (green), utility (gray).
 */
import { WorkspaceObject } from '@/lib/workspace-types';
import type { ProductionRiskData, ProductionChain, ProductionRiskVendor } from '@/lib/cfo-object-types';
import { VendorLink, formatCurrency } from '@/components/objects/VendorLink';

interface ProductionRiskMapProps {
  object: WorkspaceObject;
}

const SEVERITY_CONFIG: Record<
  string,
  {
    border: string;
    bg: string;
    headerBg: string;
    badgeBg: string;
    badgeText: string;
    statusBg: string;
    statusText: string;
    label: string;
    icon: string;
  }
> = {
  red: {
    border: 'border-red-200',
    bg: 'bg-red-50/30',
    headerBg: 'bg-red-100/60',
    badgeBg: 'bg-red-100 border border-red-200',
    badgeText: 'text-red-700',
    statusBg: 'bg-red-100 border border-red-200',
    statusText: 'text-red-700',
    label: 'CRITICAL PATH',
    icon: '⚡',
  },
  amber: {
    border: 'border-amber-200',
    bg: 'bg-amber-50/25',
    headerBg: 'bg-amber-100/50',
    badgeBg: 'bg-amber-100 border border-amber-200',
    badgeText: 'text-amber-700',
    statusBg: 'bg-amber-100 border border-amber-200',
    statusText: 'text-amber-700',
    label: 'OPERATIONAL',
    icon: '⚠',
  },
  green: {
    border: 'border-emerald-200',
    bg: 'bg-emerald-50/20',
    headerBg: 'bg-emerald-100/40',
    badgeBg: 'bg-emerald-100 border border-emerald-200',
    badgeText: 'text-emerald-700',
    statusBg: 'bg-emerald-100 border border-emerald-200',
    statusText: 'text-emerald-700',
    label: 'FACILITY',
    icon: '●',
  },
  gray: {
    border: 'border-workspace-border/50',
    bg: 'bg-workspace-surface/15',
    headerBg: 'bg-workspace-surface/35',
    badgeBg: 'bg-gray-100 border border-gray-200',
    badgeText: 'text-gray-600',
    statusBg: 'bg-gray-100 border border-gray-200',
    statusText: 'text-gray-600',
    label: 'UTILITY',
    icon: '○',
  },
};

function VendorRow({
  vendor,
  config,
}: {
  vendor: ProductionRiskVendor;
  config: typeof SEVERITY_CONFIG[string];
}) {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 rounded-lg border ${config.border} ${config.bg} px-3 py-2.5`}
    >
      {/* Left: name + tier */}
      <div className="flex-shrink-0 min-w-[130px]">
        <VendorLink name={vendor.vendor} />
        <p className="text-[10px] text-workspace-text-secondary/60 tabular-nums mt-0.5">
          Tier {vendor.tier}
        </p>
      </div>

      {/* Center: status badge + consequence */}
      <div className="flex-1 min-w-0 space-y-1">
        <span
          className={`inline-block text-[10px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full ${config.statusBg} ${config.statusText}`}
        >
          {vendor.status}
        </span>
        <p className="text-xs text-workspace-text-secondary leading-relaxed">
          {vendor.operationalConsequence}
        </p>
        {vendor.minimumToRestore !== undefined && vendor.minimumToRestore > 0 && (
          <p className="text-[10px] text-workspace-text-secondary/70 tabular-nums">
            Min. to restore: <span className="font-medium text-workspace-text">{formatCurrency(vendor.minimumToRestore)}</span>
          </p>
        )}
      </div>

      {/* Right: balance */}
      <div className="flex-shrink-0 text-right">
        <p className="text-sm font-bold tabular-nums text-workspace-text whitespace-nowrap">
          {formatCurrency(vendor.balance)}
        </p>
        <p className="text-[10px] text-workspace-text-secondary/50">balance</p>
      </div>
    </div>
  );
}

function ChainSection({ chain }: { chain: ProductionChain }) {
  if (!chain.vendors || chain.vendors.length === 0) return null;

  const config = SEVERITY_CONFIG[chain.severity] ?? SEVERITY_CONFIG.gray;

  return (
    <div className={`rounded-xl border ${config.border} overflow-hidden`}>
      {/* Header */}
      <div
        className={`flex items-center gap-2.5 px-4 py-2.5 ${config.headerBg} border-b ${config.border}`}
      >
        <span className="text-sm">{config.icon}</span>
        <span
          className={`text-[10px] font-bold uppercase tracking-[0.18em] px-2.5 py-0.5 rounded-full ${config.badgeBg} ${config.badgeText}`}
        >
          {chain.label || config.label}
        </span>
        <span className="text-[10px] text-workspace-text-secondary/60">
          {chain.vendors.length} vendor{chain.vendors.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Vendor rows */}
      <div className="p-3 space-y-2">
        {chain.vendors.map((vendor, i) => (
          <VendorRow key={`${vendor.vendor}-${i}`} vendor={vendor} config={config} />
        ))}
      </div>
    </div>
  );
}

export function ProductionRiskMap({ object }: ProductionRiskMapProps) {
  const data = object.context as ProductionRiskData | undefined;

  if (!data) {
    return (
      <p className="text-sm text-workspace-text-secondary/60">
        No production risk data available.
      </p>
    );
  }

  const chains = data.chains ?? [];
  const activeChains = chains.filter((c) => c.vendors && c.vendors.length > 0);

  // Ordered by severity for consistent display
  const SEVERITY_ORDER: Record<string, number> = { red: 0, amber: 1, green: 2, gray: 3 };
  const sortedChains = [...activeChains].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
  );

  const totalVendors = activeChains.reduce((sum, c) => sum + (c.vendors?.length ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Summary */}
      {data.summary && (
        <p className="text-sm font-medium text-workspace-text leading-relaxed">
          {data.summary}
        </p>
      )}

      {/* Severity count pills */}
      {activeChains.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sortedChains.map((chain) => {
            const config = SEVERITY_CONFIG[chain.severity] ?? SEVERITY_CONFIG.gray;
            return (
              <span
                key={chain.category}
                className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] px-2.5 py-1 rounded-full ${config.badgeBg} ${config.badgeText}`}
              >
                {config.icon} {chain.vendors.length} {chain.label || config.label}
              </span>
            );
          })}
          <span className="inline-flex items-center text-[10px] text-workspace-text-secondary/60 px-1">
            {totalVendors} total vendor{totalVendors !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Chain sections */}
      {sortedChains.length === 0 ? (
        <p className="text-sm text-workspace-text-secondary/60">
          No production risk chains to display.
        </p>
      ) : (
        <div className="space-y-3">
          {sortedChains.map((chain) => (
            <ChainSection key={chain.category} chain={chain} />
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
