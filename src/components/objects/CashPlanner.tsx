/**
 * CashPlanner — interactive cash allocation tool.
 * Enter available cash to see which vendors get paid, running balance,
 * and which items are affordable vs. unaffordable.
 */
import { useState, useCallback } from 'react';
import { WorkspaceObject } from '@/lib/workspace-types';
import { CashPlannerData, CashAllocation } from '@/lib/cfo-object-types';
import { VendorLink, formatCurrency } from '@/components/objects/VendorLink';
import { useWorkspace } from '@/contexts/WorkspaceContext';

interface CashPlannerProps {
  object: WorkspaceObject;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<CashAllocation['category'], { badge: string; label: string }> = {
  'quick-win': {
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    label: 'Quick Win',
  },
  'production-critical': {
    badge: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    label: 'Production Critical',
  },
  'legal-mitigation': {
    badge: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
    label: 'Legal Mitigation',
  },
  relationship: {
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    label: 'Relationship',
  },
};

/** Parse a dollar-formatted string back to a number. Returns NaN if invalid. */
function parseDollarInput(value: string): number {
  const stripped = value.replace(/[^0-9.]/g, '');
  return parseFloat(stripped);
}

/** Format a raw number string as display-friendly dollars while typing. */
function formatDollarInput(value: string): string {
  const numeric = parseDollarInput(value);
  if (isNaN(numeric) || value === '') return value;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(numeric);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AllocationRow({
  item,
  runningBalance,
  availableCash,
  index,
}: {
  item: CashAllocation;
  runningBalance: number | null;
  availableCash: number | null;
  index: number;
}) {
  const catStyle = CATEGORY_STYLES[item.category] ?? {
    badge: 'bg-workspace-surface text-workspace-text-secondary',
    label: item.category,
  };

  // Determine affordability state
  const hasAmount = availableCash !== null;
  const isAffordable = hasAmount && runningBalance !== null && runningBalance >= 0;
  const isDimmed = hasAmount && !isAffordable;

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
        isAffordable
          ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-800/40 dark:bg-emerald-900/10'
          : isDimmed
          ? 'border-workspace-border/20 bg-workspace-surface/10 opacity-40'
          : 'border-workspace-border/30 bg-workspace-surface/20'
      }`}
    >
      {/* Priority number */}
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums ${
          isAffordable
            ? 'bg-emerald-500 text-white'
            : 'bg-workspace-border/50 text-workspace-text-secondary'
        }`}
      >
        {index + 1}
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-0.5">
        {/* Row 1: vendor + amount + category badge */}
        <div className="flex flex-wrap items-center gap-2">
          <VendorLink name={item.vendor} />
          <span className="text-sm font-bold tabular-nums text-workspace-text">
            {formatCurrency(item.recommendedPayment)}
          </span>
          {item.isMinimumPayment && (
            <span className="text-[10px] text-workspace-text-secondary">(min)</span>
          )}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${catStyle.badge}`}>
            {catStyle.label}
          </span>
          {item.isFullyResolved && (
            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              Fully Resolves
            </span>
          )}
        </div>

        {/* Rationale */}
        {item.rationale && (
          <p className="text-xs leading-relaxed text-workspace-text-secondary">
            {item.rationale}
          </p>
        )}

        {/* Operational impact */}
        {item.operationalImpact && (
          <p className="text-[11px] text-workspace-text-secondary/70">
            Impact: {item.operationalImpact}
          </p>
        )}
      </div>

      {/* Running balance (right side, only when cash is set) */}
      {hasAmount && runningBalance !== null && (
        <div className="ml-auto shrink-0 text-right">
          <p className={`text-[10px] tabular-nums font-medium ${runningBalance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
            {runningBalance >= 0 ? formatCurrency(runningBalance) : 'Insufficient'} left
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CashPlanner({ object }: CashPlannerProps) {
  const { dispatch } = useWorkspace();
  const data = object.context as CashPlannerData | undefined;

  // Local input state — raw string for controlled input
  const initialCash = data?.availableCash;
  const [inputValue, setInputValue] = useState<string>(
    initialCash != null ? formatDollarInput(String(initialCash)) : ''
  );
  const [isFocused, setIsFocused] = useState(false);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setInputValue(raw);
    },
    []
  );

  const commitValue = useCallback(() => {
    setIsFocused(false);
    const numeric = parseDollarInput(inputValue);
    if (!isNaN(numeric) && inputValue.trim() !== '') {
      // Format the display value
      setInputValue(formatDollarInput(inputValue));
      // Persist to workspace context
      dispatch({
        type: 'UPDATE_OBJECT_CONTEXT',
        payload: {
          id: object.id,
          context: { ...data, availableCash: numeric },
        },
      });
    } else if (inputValue.trim() === '') {
      // User cleared the field — reset to null
      dispatch({
        type: 'UPDATE_OBJECT_CONTEXT',
        payload: {
          id: object.id,
          context: { ...data, availableCash: null },
        },
      });
    }
  }, [inputValue, data, dispatch, object.id]);

  if (!data || !data.allocations) {
    return (
      <p className="text-sm text-workspace-text-secondary/60">
        No cash plan available. Ask Sherpa to generate a cash planner.
      </p>
    );
  }

  // Resolve effective available cash (prefer context if committed, otherwise null)
  const effectiveCash = data.availableCash ?? null;

  // Compute per-row running balances
  const allAllocations = data.allocations ?? [];
  const runningBalances: (number | null)[] = [];
  if (effectiveCash !== null) {
    let balance = effectiveCash;
    for (const item of allAllocations) {
      balance -= item.recommendedPayment;
      runningBalances.push(balance);
    }
  }

  // Stats for the summary bar
  const affordableItems = effectiveCash !== null
    ? allAllocations.filter((_, i) => runningBalances[i] !== null && runningBalances[i]! >= 0)
    : [];
  const totalAllocated = affordableItems.reduce((s, a) => s + a.recommendedPayment, 0);
  const vendorsResolved = affordableItems.filter((a) => a.isFullyResolved).length;

  const summary = data.summary;
  const quickWinsCount = summary?.quickWinsCount ?? 0;
  const quickWinsTotal = summary?.quickWinsTotal ?? 0;
  const totalNeeded = summary?.totalNeeded ?? allAllocations.reduce((s, a) => s + a.recommendedPayment, 0);

  return (
    <div className="space-y-5">

      {/* ── Cash Input ──────────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <label
          htmlFor={`cash-input-${object.id}`}
          className="text-[10px] font-bold uppercase tracking-[0.18em] text-workspace-text-secondary/60"
        >
          Available Cash
        </label>
        <div className="relative flex items-center">
          <span className="pointer-events-none absolute left-3 text-sm font-semibold text-workspace-text-secondary">
            $
          </span>
          <input
            id={`cash-input-${object.id}`}
            type="text"
            inputMode="numeric"
            value={isFocused ? inputValue.replace(/[^0-9.]/g, '') : inputValue}
            placeholder="0"
            onFocus={() => {
              setIsFocused(true);
              // Strip formatting for raw editing
              const numeric = parseDollarInput(inputValue);
              if (!isNaN(numeric)) setInputValue(String(numeric));
            }}
            onChange={handleInputChange}
            onBlur={commitValue}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            className="w-full rounded-xl border border-workspace-border bg-workspace-surface/30 py-2.5 pl-7 pr-3 text-sm font-semibold tabular-nums text-workspace-text placeholder:text-workspace-text-secondary/40 focus:border-workspace-accent focus:outline-none focus:ring-1 focus:ring-workspace-accent/30 transition-colors"
          />
        </div>
        {effectiveCash === null && (
          <p className="text-[11px] text-workspace-text-secondary/60">
            Enter your available cash to see what you can allocate.
          </p>
        )}
      </div>

      {/* ── Running Total Bar ────────────────────────────────────────────────── */}
      {(effectiveCash !== null || allAllocations.length > 0) && (
        <div className="rounded-xl border border-workspace-border/40 bg-workspace-surface/20 px-4 py-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-workspace-text-secondary">
              <span className="font-bold tabular-nums text-workspace-text">
                {formatCurrency(effectiveCash !== null ? totalAllocated : 0)}
              </span>
              {' '}of{' '}
              <span className="tabular-nums">{formatCurrency(totalNeeded)}</span>
              {' '}allocated
            </span>
            <span className="tabular-nums text-workspace-text-secondary">
              <span className="font-bold text-workspace-text">{vendorsResolved}</span> vendors resolved
            </span>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-workspace-border/30">
            <div
              className="h-full rounded-full bg-workspace-accent transition-all duration-300"
              style={{
                width: totalNeeded > 0 && effectiveCash !== null
                  ? `${Math.min((totalAllocated / totalNeeded) * 100, 100)}%`
                  : '0%',
              }}
            />
          </div>
        </div>
      )}

      {/* ── Allocation List ─────────────────────────────────────────────────── */}
      {allAllocations.length === 0 ? (
        <p className="text-sm text-workspace-text-secondary/60">
          No allocations in this plan.
        </p>
      ) : (
        <div className="space-y-2">
          <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-workspace-text-secondary/60">
            Prioritized Payments
          </h4>
          {allAllocations.map((item, i) => (
            <AllocationRow
              key={`${item.vendor}-${i}`}
              item={item}
              index={i}
              availableCash={effectiveCash}
              runningBalance={effectiveCash !== null ? (runningBalances[i] ?? null) : null}
            />
          ))}
        </div>
      )}

      {/* ── Quick Wins Section ───────────────────────────────────────────────── */}
      {quickWinsCount > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 px-4 py-3 dark:border-emerald-800/40 dark:bg-emerald-900/10">
          <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
            Quick Wins: Pay{' '}
            <span className="tabular-nums">{formatCurrency(quickWinsTotal)}</span>
            {' '}to unblock{' '}
            <span>{quickWinsCount}</span>{' '}
            {quickWinsCount === 1 ? 'vendor' : 'vendors'}
          </p>
        </div>
      )}

      {/* ── Summary Paragraph ───────────────────────────────────────────────── */}
      {summary?.operationalImpact && (
        <p className="text-xs leading-relaxed text-workspace-text-secondary">
          {summary.operationalImpact}
        </p>
      )}
    </div>
  );
}
