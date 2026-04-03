/**
 * AutomationPanel — lists and manages active automation triggers.
 *
 * Context fields (optional — if not provided, fetches from Supabase directly):
 *   triggers? — pre-fetched AutomationTrigger[]
 *
 * The user can toggle, delete, and review when each trigger last fired.
 */
import { useState, useEffect, useCallback } from 'react';
import { WorkspaceObject } from '@/lib/workspace-types';
import { loadTriggers, toggleTrigger, deleteTrigger, AutomationTrigger } from '@/lib/automation-triggers';
import { useToast } from '@/hooks/use-toast';

interface Props {
  object: WorkspaceObject;
}

function formatAge(isoString: string | null): string {
  if (!isoString) return 'Never';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return 'Just now';
}

const OPERATOR_LABELS: Record<string, string> = {
  gt: '>', lt: '<', gte: '≥', lte: '≤', eq: '=', neq: '≠',
};

export function AutomationPanel({ object: _object }: Props) {
  const [triggers, setTriggers] = useState<AutomationTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchTriggers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadTriggers();
      setTriggers(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTriggers();
  }, [fetchTriggers]);

  const handleToggle = async (id: string, current: boolean) => {
    const ok = await toggleTrigger(id, !current);
    if (ok) {
      setTriggers(prev => prev.map(t => t.id === id ? { ...t, enabled: !current } : t));
      toast({ title: `Trigger ${!current ? 'enabled' : 'disabled'}` });
    }
  };

  const handleDelete = async (id: string, label: string) => {
    const ok = await deleteTrigger(id);
    if (ok) {
      setTriggers(prev => prev.filter(t => t.id !== id));
      toast({ title: `Trigger deleted`, description: label });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-workspace-text-secondary/60 py-4">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-workspace-accent border-t-transparent animate-spin" />
        Loading triggers...
      </div>
    );
  }

  if (triggers.length === 0) {
    return (
      <div className="rounded-xl border border-workspace-border/60 bg-white/60 px-4 py-6 text-center">
        <p className="text-sm font-medium text-workspace-text-secondary/70">No active triggers</p>
        <p className="mt-1 text-[11px] text-workspace-text-secondary/50">
          Ask Sherpa to "automatically notify me when [condition]" to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-workspace-text-secondary/60">
          {triggers.length} active trigger{triggers.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={fetchTriggers}
          className="text-[10px] text-workspace-text-secondary/50 hover:text-workspace-accent transition-colors"
        >
          Refresh
        </button>
      </div>

      {triggers.map((trigger) => {
        const cond = trigger.condition;
        const op = OPERATOR_LABELS[cond.operator] || cond.operator;
        const condStr = `${cond.column} ${op} ${cond.value}${cond.aggregation && cond.aggregation !== 'any' ? ` (${cond.aggregation})` : ''}`;

        return (
          <div
            key={trigger.id}
            className={`rounded-xl border px-4 py-3 transition-all ${
              trigger.enabled
                ? 'border-workspace-accent/20 bg-workspace-accent/[0.04]'
                : 'border-workspace-border/60 bg-white/60 opacity-60'
            }`}
          >
            <div className="flex items-start gap-3">
              {/* Toggle */}
              <button
                onClick={() => handleToggle(trigger.id, trigger.enabled)}
                className={`mt-0.5 flex-shrink-0 h-4 w-8 rounded-full border transition-all ${
                  trigger.enabled
                    ? 'bg-workspace-accent border-workspace-accent'
                    : 'bg-workspace-border/50 border-workspace-border'
                }`}
                title={trigger.enabled ? 'Disable trigger' : 'Enable trigger'}
              >
                <span className={`block h-3 w-3 rounded-full bg-white shadow-sm transition-transform mx-0.5 ${trigger.enabled ? 'translate-x-3.5' : 'translate-x-0'}`} />
              </button>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-workspace-text truncate">{trigger.label}</p>
                <p className="text-[11px] text-workspace-text-secondary/70 mt-0.5 font-mono">{condStr}</p>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${
                    trigger.action.type === 'create_card'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-workspace-border bg-white/80 text-workspace-text-secondary'
                  }`}>
                    {trigger.action.type === 'create_card' ? '◈ Creates card' : '◎ Notifies'}
                  </span>
                  {trigger.fire_count > 0 && (
                    <span className="text-[10px] text-workspace-text-secondary/50">
                      Fired {trigger.fire_count}× · Last {formatAge(trigger.last_fired_at)}
                    </span>
                  )}
                  {trigger.fire_count === 0 && (
                    <span className="text-[10px] text-workspace-text-secondary/40">Never fired</span>
                  )}
                </div>
              </div>

              {/* Delete */}
              <button
                onClick={() => handleDelete(trigger.id, trigger.label)}
                className="flex-shrink-0 rounded-md p-1 text-workspace-text-secondary/30 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="Delete trigger"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
