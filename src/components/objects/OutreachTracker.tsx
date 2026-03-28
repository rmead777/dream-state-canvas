/**
 * OutreachTracker — surfaces vendor communication status across three states:
 * promises made, no-response, and contacts completed.
 */
import { WorkspaceObject } from '@/lib/workspace-types';
import type { OutreachTrackerData, OutreachItem } from '@/lib/cfo-object-types';
import { VendorLink, formatCurrency } from '@/components/objects/VendorLink';

interface OutreachTrackerProps {
  object: WorkspaceObject;
}

// ─── Status badge helpers ─────────────────────────────────────────────────────

const STATUS_BADGE: Record<OutreachItem['status'], string> = {
  overdue: 'bg-red-100 text-red-700 border border-red-200',
  pending: 'bg-amber-100 text-amber-700 border border-amber-200',
  'no-response': 'bg-red-50 text-red-600 border border-red-200',
  completed: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
};

const STATUS_LABEL: Record<OutreachItem['status'], string> = {
  overdue: 'OVERDUE',
  pending: 'PENDING',
  'no-response': 'NO RESPONSE',
  completed: 'COMPLETED',
};

// ─── Individual item cards ────────────────────────────────────────────────────

function PromiseCard({ item }: { item: OutreachItem }) {
  const isOverdue = item.status === 'overdue';

  return (
    <div
      className={`rounded-lg border px-4 py-3 space-y-2 ${
        isOverdue
          ? 'border-amber-200 bg-amber-50/40'
          : 'border-amber-100 bg-amber-50/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <VendorLink name={item.vendor} />
          <p className="text-xs text-workspace-text-secondary tabular-nums mt-0.5">
            {formatCurrency(item.balance)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className={`text-[10px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full ${STATUS_BADGE[item.status]}`}>
            {STATUS_LABEL[item.status]}
          </span>
          {isOverdue && item.daysSinceAction !== null && (
            <span className="text-[10px] text-red-600 tabular-nums font-medium">
              {item.daysSinceAction}d overdue
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-workspace-text-secondary leading-relaxed">
        {item.description}
      </p>

      <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-amber-200/40">
        <p className="text-[10px] text-workspace-text-secondary/60 tabular-nums">
          Date: {item.date}
        </p>
        {item.suggestedNextStep && (
          <p className="text-[10px] text-workspace-text-secondary/70 text-right">
            Next: {item.suggestedNextStep}
          </p>
        )}
      </div>
    </div>
  );
}

function NoResponseCard({ item }: { item: OutreachItem }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/30 px-4 py-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <VendorLink name={item.vendor} />
          <p className="text-xs text-workspace-text-secondary tabular-nums mt-0.5">
            {formatCurrency(item.balance)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className={`text-[10px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full ${STATUS_BADGE['no-response']}`}>
            {STATUS_LABEL['no-response']}
          </span>
          {item.daysSinceAction !== null && (
            <span className="text-[10px] text-red-600 tabular-nums font-medium">
              {item.daysSinceAction}d waiting
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-workspace-text-secondary leading-relaxed">
        {item.description}
      </p>

      <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-red-200/40">
        <p className="text-[10px] text-workspace-text-secondary/60 tabular-nums">
          Last contact: {item.date}
        </p>
        {item.suggestedNextStep && (
          <p className="text-[10px] text-workspace-text-secondary/70 text-right">
            Next: {item.suggestedNextStep}
          </p>
        )}
      </div>
    </div>
  );
}

function ContactCard({ item }: { item: OutreachItem }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/25 px-4 py-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <VendorLink name={item.vendor} />
          <p className="text-xs text-workspace-text-secondary tabular-nums mt-0.5">
            {formatCurrency(item.balance)}
          </p>
        </div>
        <span className={`flex-shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full ${STATUS_BADGE['completed']}`}>
          {STATUS_LABEL['completed']}
        </span>
      </div>

      <p className="text-xs text-workspace-text-secondary leading-relaxed">
        {item.description}
      </p>

      <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-emerald-200/40">
        <p className="text-[10px] text-workspace-text-secondary/60 tabular-nums">
          {item.date}
          {item.daysSinceAction !== null && ` · ${item.daysSinceAction}d ago`}
        </p>
        {item.suggestedNextStep && (
          <p className="text-[10px] text-workspace-text-secondary/70 text-right">
            Next: {item.suggestedNextStep}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Section wrappers ─────────────────────────────────────────────────────────

function PromisesSection({ items }: { items: OutreachItem[] }) {
  if (items.length === 0) return null;

  const overdueCount = items.filter((i) => i.status === 'overdue').length;

  // Sort: overdue first, then by daysSinceAction descending
  const sorted = [...items].sort((a, b) => {
    if (a.status === 'overdue' && b.status !== 'overdue') return -1;
    if (b.status === 'overdue' && a.status !== 'overdue') return 1;
    return (b.daysSinceAction ?? 0) - (a.daysSinceAction ?? 0);
  });

  return (
    <div className="rounded-xl border border-amber-200 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-2.5 bg-amber-100/50 border-b border-amber-200">
        <span className="text-sm">📋</span>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
          PROMISES MADE
        </span>
        <span className="text-[10px] text-workspace-text-secondary/60">
          {items.length} promise{items.length !== 1 ? 's' : ''}
          {overdueCount > 0 && (
            <span className="text-red-600 font-medium"> · {overdueCount} overdue</span>
          )}
        </span>
      </div>
      <div className="p-3 space-y-2">
        {sorted.map((item, i) => (
          <PromiseCard key={`${item.vendor}-${i}`} item={item} />
        ))}
      </div>
    </div>
  );
}

function NoResponseSection({ items }: { items: OutreachItem[] }) {
  if (items.length === 0) return null;

  // Sort by days waiting descending — most neglected first
  const sorted = [...items].sort((a, b) => (b.daysSinceAction ?? 0) - (a.daysSinceAction ?? 0));

  return (
    <div className="rounded-xl border border-red-200 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-2.5 bg-red-100/50 border-b border-red-200">
        <span className="text-sm">🔇</span>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
          NO RESPONSE
        </span>
        <span className="text-[10px] text-workspace-text-secondary/60">
          {items.length} vendor{items.length !== 1 ? 's' : ''} · sorted by neglect
        </span>
      </div>
      <div className="p-3 space-y-2">
        {sorted.map((item, i) => (
          <NoResponseCard key={`${item.vendor}-${i}`} item={item} />
        ))}
      </div>
    </div>
  );
}

function ContactsMadeSection({ items }: { items: OutreachItem[] }) {
  if (items.length === 0) return null;

  // Sort by date descending — most recent first
  const sorted = [...items].sort((a, b) => {
    if (!a.date || !b.date) return 0;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  return (
    <div className="rounded-xl border border-emerald-200 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-2.5 bg-emerald-100/40 border-b border-emerald-200">
        <span className="text-sm">✓</span>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
          CONTACTS MADE
        </span>
        <span className="text-[10px] text-workspace-text-secondary/60">
          {items.length} completed
        </span>
      </div>
      <div className="p-3 space-y-2">
        {sorted.map((item, i) => (
          <ContactCard key={`${item.vendor}-${i}`} item={item} />
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function OutreachTracker({ object }: OutreachTrackerProps) {
  const data = object.context as OutreachTrackerData | undefined;

  if (!data) {
    return (
      <p className="text-sm text-workspace-text-secondary/60">
        No outreach data available.
      </p>
    );
  }

  const promises = data.promises ?? [];
  const noResponse = data.noResponse ?? [];
  const contactsMade = data.contactsMade ?? [];
  const summary = data.summary;

  const overdueCount = summary?.overduePromises ?? promises.filter((i) => i.status === 'overdue').length;
  const noResponseCount = summary?.vendorsWithNoResponse ?? noResponse.length;
  const contactsCount = summary?.contactsMadeCount ?? contactsMade.length;

  const hasAnyData = promises.length > 0 || noResponse.length > 0 || contactsMade.length > 0;

  return (
    <div className="space-y-4">
      {/* Summary line */}
      <p className="text-sm font-medium text-workspace-text leading-relaxed">
        {overdueCount > 0 && (
          <span className="text-red-600">{overdueCount} overdue promise{overdueCount !== 1 ? 's' : ''}</span>
        )}
        {overdueCount > 0 && noResponseCount > 0 && <span className="text-workspace-text-secondary/60"> · </span>}
        {noResponseCount > 0 && (
          <span className="text-red-500">{noResponseCount} zero-response vendor{noResponseCount !== 1 ? 's' : ''}</span>
        )}
        {(overdueCount > 0 || noResponseCount > 0) && contactsCount > 0 && (
          <span className="text-workspace-text-secondary/60"> · </span>
        )}
        {contactsCount > 0 && (
          <span className="text-emerald-600">{contactsCount} contact{contactsCount !== 1 ? 's' : ''} made</span>
        )}
        {!overdueCount && !noResponseCount && !contactsCount && (
          <span className="text-workspace-text-secondary/60">No outreach activity to display.</span>
        )}
      </p>

      {/* Sections */}
      {!hasAnyData ? (
        <p className="text-sm text-workspace-text-secondary/60">
          No outreach items found.
        </p>
      ) : (
        <div className="space-y-3">
          <PromisesSection items={promises} />
          <NoResponseSection items={noResponse} />
          <ContactsMadeSection items={contactsMade} />
        </div>
      )}

      {/* Credibility note */}
      {data.credibilityNote && (
        <div className="flex items-start gap-2.5 rounded-lg border-l-[3px] border-amber-300 bg-amber-50/40 px-4 py-3">
          <span className="text-sm mt-0.5">⚠</span>
          <p className="text-xs text-workspace-text leading-relaxed">
            <span className="font-semibold text-amber-700">Credibility note: </span>
            {data.credibilityNote}
          </p>
        </div>
      )}
    </div>
  );
}
