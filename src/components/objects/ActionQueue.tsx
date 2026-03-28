/**
 * ActionQueue — renders a prioritized action list grouped by time bucket.
 * Supports checkbox completion, quick-win badges, deadline urgency, and
 * a running summary of progress and allocated dollars.
 */
import { WorkspaceObject } from '@/lib/workspace-types';
import { ActionQueueData, ActionItem, ActionBucket } from '@/lib/cfo-object-types';
import { VendorLink, formatCurrency } from '@/components/objects/VendorLink';
import { useWorkspace } from '@/contexts/WorkspaceContext';

interface ActionQueueProps {
  object: WorkspaceObject;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ACTION_TYPE_LABELS: Record<ActionItem['actionType'], string> = {
  call: 'Call',
  pay: 'Pay',
  'follow-up': 'Follow-up',
  negotiate: 'Negotiate',
  verify: 'Verify',
};

const ACTION_TYPE_COLORS: Record<ActionItem['actionType'], string> = {
  call: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  pay: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  'follow-up': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  negotiate: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  verify: 'bg-workspace-surface text-workspace-text-secondary',
};

const URGENCY_STYLES: Record<ActionBucket['urgency'], { header: string; dot: string }> = {
  immediate: {
    header: 'text-red-600 dark:text-red-400',
    dot: 'bg-red-500',
  },
  'this-week': {
    header: 'text-amber-600 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  'next-week': {
    header: 'text-workspace-text-secondary',
    dot: 'bg-workspace-border',
  },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function ActionRow({
  item,
  onToggle,
}: {
  item: ActionItem;
  onToggle: (id: string) => void;
}) {
  const actionColor = ACTION_TYPE_COLORS[item.actionType] ?? 'bg-workspace-surface text-workspace-text-secondary';
  const isOverdue = item.deadlinePassed && !item.completed;

  return (
    <div
      className={`group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-workspace-surface/40 ${
        item.completed ? 'opacity-40' : ''
      }`}
    >
      {/* Checkbox */}
      <button
        onClick={() => onToggle(item.id)}
        aria-label={item.completed ? 'Mark incomplete' : 'Mark complete'}
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
          item.completed
            ? 'border-workspace-accent bg-workspace-accent text-white'
            : 'border-workspace-border bg-workspace-surface hover:border-workspace-accent'
        }`}
      >
        {item.completed && (
          <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 10 8">
            <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-0.5">
        {/* Top row: vendor + amount + badges */}
        <div className="flex flex-wrap items-center gap-2">
          <span className={item.completed ? 'line-through text-workspace-text-secondary' : ''}>
            <VendorLink name={item.vendor} />
          </span>
          <span className="tabular-nums text-sm font-semibold text-workspace-text">
            {formatCurrency(item.amount)}
          </span>
          {/* Action type badge */}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${actionColor}`}>
            {ACTION_TYPE_LABELS[item.actionType] ?? item.actionType}
          </span>
          {/* Quick win badge */}
          {item.isQuickWin && !item.completed && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              Quick Win
            </span>
          )}
          {/* Deadline passed indicator */}
          {isOverdue && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-red-600 dark:text-red-400">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              Overdue
            </span>
          )}
        </div>

        {/* Description */}
        {item.description && (
          <p className={`text-xs leading-relaxed text-workspace-text-secondary ${item.completed ? 'line-through' : ''}`}>
            {item.description}
          </p>
        )}

        {/* Contact + Goal row */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pt-0.5">
          {item.contact && (
            <span className="text-[11px] text-workspace-text-secondary">
              Contact:{' '}
              {item.contactEmail ? (
                <a
                  href={`mailto:${item.contactEmail}`}
                  className="text-workspace-accent hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {item.contact}
                </a>
              ) : (
                <span>{item.contact}</span>
              )}
            </span>
          )}
          {item.goal && (
            <span className="text-[11px] text-workspace-text-secondary">
              Goal: <span className="text-workspace-text">{item.goal}</span>
            </span>
          )}
        </div>

        {/* Deadline */}
        {item.deadline && (
          <p className={`text-[11px] tabular-nums ${isOverdue ? 'text-red-500 dark:text-red-400' : 'text-workspace-text-secondary'}`}>
            Due {item.deadline}
          </p>
        )}
      </div>
    </div>
  );
}

function BucketSection({
  bucket,
  onToggle,
}: {
  bucket: ActionBucket;
  onToggle: (id: string) => void;
}) {
  const style = URGENCY_STYLES[bucket.urgency] ?? URGENCY_STYLES['next-week'];
  const completedCount = bucket.actions.filter((a) => a.completed).length;

  if (bucket.actions.length === 0) return null;

  return (
    <section className="space-y-1">
      {/* Bucket header */}
      <div className="flex items-center gap-2 px-1 pb-1">
        <span className={`h-2 w-2 rounded-full ${style.dot}`} />
        <h3 className={`text-[11px] font-bold uppercase tracking-[0.15em] ${style.header}`}>
          {bucket.label}
        </h3>
        <span className="ml-auto text-[10px] tabular-nums text-workspace-text-secondary">
          {completedCount}/{bucket.actions.length}
        </span>
      </div>

      {/* Divider */}
      <div className="mx-1 mb-2 h-px bg-workspace-border/40" />

      {/* Action rows */}
      <div className="space-y-0.5">
        {bucket.actions.map((action) => (
          <ActionRow key={action.id} item={action} onToggle={onToggle} />
        ))}
      </div>
    </section>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ActionQueue({ object }: ActionQueueProps) {
  const { dispatch } = useWorkspace();
  const data = object.context as ActionQueueData | undefined;

  // Handle completely missing data
  if (!data || !data.buckets) {
    return (
      <p className="text-sm text-workspace-text-secondary/60">
        No actions available. Ask Sherpa to generate an action queue.
      </p>
    );
  }

  const allActions = data.buckets.flatMap((b) => b.actions ?? []);
  const completedCount = allActions.filter((a) => a.completed).length;
  const totalCount = allActions.length;
  const allocatedTotal = allActions
    .filter((a) => !a.completed)
    .reduce((sum, a) => sum + (a.amount ?? 0), 0);

  function handleToggle(actionId: string) {
    const updatedBuckets = data!.buckets.map((bucket) => ({
      ...bucket,
      actions: bucket.actions.map((action) =>
        action.id === actionId ? { ...action, completed: !action.completed } : action
      ),
    }));
    dispatch({
      type: 'UPDATE_OBJECT_CONTEXT',
      payload: {
        id: object.id,
        context: { ...data, buckets: updatedBuckets },
      },
    });
  }

  const nonEmptyBuckets = data.buckets.filter((b) => b.actions && b.actions.length > 0);

  return (
    <div className="space-y-5">
      {/* Time horizon meta */}
      {data.timeHorizon && (
        <p className="text-[11px] text-workspace-text-secondary/70">
          Horizon: <span className="font-medium text-workspace-text-secondary">{data.timeHorizon}</span>
        </p>
      )}

      {/* Empty state */}
      {nonEmptyBuckets.length === 0 && (
        <p className="text-sm text-workspace-text-secondary/60">
          No actions in the queue for this horizon.
        </p>
      )}

      {/* Bucket sections */}
      {nonEmptyBuckets.map((bucket) => (
        <BucketSection key={bucket.label} bucket={bucket} onToggle={handleToggle} />
      ))}

      {/* Summary bar */}
      {totalCount > 0 && (
        <div className="rounded-xl border border-workspace-border/40 bg-workspace-surface/30 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-workspace-text-secondary">
              <span className="font-semibold tabular-nums text-workspace-text">
                {completedCount} of {totalCount}
              </span>{' '}
              completed
            </p>
            <p className="text-xs tabular-nums text-workspace-text-secondary">
              <span className="font-semibold text-workspace-text">{formatCurrency(allocatedTotal)}</span> remaining
            </p>
          </div>
          {/* Progress bar */}
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-workspace-border/30">
            <div
              className="h-full rounded-full bg-workspace-accent transition-all duration-300"
              style={{ width: totalCount > 0 ? `${(completedCount / totalCount) * 100}%` : '0%' }}
            />
          </div>
        </div>
      )}

      {/* AI summary narrative */}
      {data.summary && (
        <p className="text-xs leading-relaxed text-workspace-text-secondary">
          {data.summary}
        </p>
      )}
    </div>
  );
}
