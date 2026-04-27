/**
 * AutomationPanel — list, build, and manage automation triggers.
 *
 * Displays existing triggers and exposes an inline builder so users can
 * create rules manually (instead of only via Sherpa). Supports stacking
 * multiple conditions on the same column with AND/OR combinators and
 * the full operator set: gt/lt/gte/lte/eq/neq/between/in/not_in/contains/
 * not_contains/starts_with/ends_with/equals_text/is_null/is_not_null.
 */
import { useState, useEffect, useCallback } from 'react';
import { WorkspaceObject } from '@/lib/workspace-types';
import {
  loadAllTriggers, toggleTrigger, deleteTrigger, createTrigger,
  AutomationTrigger, TriggerOperator, TriggerRule, getRules,
} from '@/lib/automation-triggers';
import { listDocuments, extractDataset } from '@/lib/document-store';
import { useToast } from '@/hooks/use-toast';

interface Props {
  object: WorkspaceObject;
}

const OPERATOR_LABELS: Record<TriggerOperator, string> = {
  gt: '>', lt: '<', gte: '≥', lte: '≤', eq: '=', neq: '≠',
  between: 'between',
  contains: 'contains', not_contains: 'not contains',
  starts_with: 'starts with', ends_with: 'ends with', equals_text: 'is exactly',
  in: 'is one of', not_in: 'is not one of',
  is_null: 'is empty', is_not_null: 'is not empty',
};

const OPERATOR_GROUPS: { label: string; ops: TriggerOperator[] }[] = [
  { label: 'Number / Date', ops: ['gt', 'lt', 'gte', 'lte', 'eq', 'neq', 'between'] },
  { label: 'Text',          ops: ['contains', 'not_contains', 'starts_with', 'ends_with', 'equals_text'] },
  { label: 'Set',           ops: ['in', 'not_in'] },
  { label: 'Empty',         ops: ['is_null', 'is_not_null'] },
];

const NO_VALUE_OPS: TriggerOperator[] = ['is_null', 'is_not_null'];

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

function describeRule(r: TriggerRule): string {
  const op = OPERATOR_LABELS[r.operator] ?? r.operator;
  if (NO_VALUE_OPS.includes(r.operator)) return `${r.column} ${op}`;
  if (r.operator === 'between') return `${r.column} ${op} ${r.value} – ${r.valueMax}`;
  if (Array.isArray(r.value)) return `${r.column} ${op} [${r.value.join(', ')}]`;
  return `${r.column} ${op} ${r.value}`;
}

export function AutomationPanel({ object: _object }: Props) {
  const [triggers, setTriggers] = useState<AutomationTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const { toast } = useToast();

  const fetchTriggers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadAllTriggers();
      setTriggers(data);
    } finally {
      setLoading(false);
    }
  }, []);

  // Pull columns from any uploaded dataset so the builder can offer a column dropdown.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const docs = await listDocuments();
        const cols = new Set<string>();
        for (const d of docs) {
          const ds = extractDataset(d);
          if (ds) ds.columns.forEach(c => cols.add(c));
        }
        if (!cancelled) setColumns(Array.from(cols).sort());
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { fetchTriggers(); }, [fetchTriggers]);

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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-workspace-text-secondary/60">
          {triggers.length} trigger{triggers.length !== 1 ? 's' : ''}
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowBuilder(s => !s)}
            className="text-[10px] font-medium text-workspace-accent hover:underline"
          >
            {showBuilder ? '× Cancel' : '+ New trigger'}
          </button>
          <button
            onClick={fetchTriggers}
            className="text-[10px] text-workspace-text-secondary/50 hover:text-workspace-accent transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {showBuilder && (
        <TriggerBuilder
          columns={columns}
          onCancel={() => setShowBuilder(false)}
          onCreated={(t) => {
            setTriggers(prev => [...prev, t]);
            setShowBuilder(false);
            toast({ title: 'Trigger created', description: t.label });
          }}
        />
      )}

      {triggers.length === 0 && !showBuilder && (
        <div className="rounded-xl border border-workspace-border/60 bg-white/60 px-4 py-6 text-center">
          <p className="text-sm font-medium text-workspace-text-secondary/70">No triggers yet</p>
          <p className="mt-1 text-[11px] text-workspace-text-secondary/50">
            Click <span className="font-semibold text-workspace-accent">+ New trigger</span> above, or ask Sherpa to create one.
          </p>
        </div>
      )}

      {triggers.map((trigger) => {
        const rules = getRules(trigger.condition);
        const combinator = trigger.condition.combinator ?? 'AND';

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

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-workspace-text truncate">{trigger.label}</p>
                <div className="text-[11px] text-workspace-text-secondary/70 mt-0.5 font-mono space-y-0.5">
                  {rules.map((r, i) => (
                    <div key={i}>
                      {i > 0 && <span className="text-workspace-accent/70 mr-1">{combinator}</span>}
                      {describeRule(r)}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${
                    trigger.action.type === 'create_card'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-workspace-border bg-white/80 text-workspace-text-secondary'
                  }`}>
                    {trigger.action.type === 'create_card' ? '◈ Creates card' : '◎ Notifies'}
                  </span>
                  {trigger.fire_count > 0 ? (
                    <span className="text-[10px] text-workspace-text-secondary/50">
                      Fired {trigger.fire_count}× · Last {formatAge(trigger.last_fired_at)}
                    </span>
                  ) : (
                    <span className="text-[10px] text-workspace-text-secondary/40">Never fired</span>
                  )}
                </div>
              </div>

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

// ───────────────────────── Inline Builder ─────────────────────────

interface BuilderProps {
  columns: string[];
  onCancel: () => void;
  onCreated: (t: AutomationTrigger) => void;
}

function emptyRule(col = ''): TriggerRule {
  return { column: col, operator: 'gt', value: '' };
}

function TriggerBuilder({ columns, onCancel, onCreated }: BuilderProps) {
  const [label, setLabel] = useState('');
  const [rules, setRules] = useState<TriggerRule[]>([emptyRule(columns[0] ?? '')]);
  const [combinator, setCombinator] = useState<'AND' | 'OR'>('AND');
  const [actionType, setActionType] = useState<'notify' | 'create_card'>('notify');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const updateRule = (i: number, patch: Partial<TriggerRule>) => {
    setRules(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };

  const handleSave = async () => {
    if (!label.trim()) { toast({ title: 'Add a label first' }); return; }
    if (rules.some(r => !r.column)) { toast({ title: 'Pick a column for each rule' }); return; }
    setSaving(true);
    try {
      const created = await createTrigger({
        label: label.trim(),
        condition: { rules, combinator },
        action: { type: actionType, params: {} },
      });
      if (!created) { toast({ title: 'Failed to create trigger' }); return; }
      onCreated(created);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-workspace-accent/30 bg-white/80 px-4 py-3 space-y-3">
      <input
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="Trigger name (e.g. 'Late deliveries this week')"
        className="w-full px-2 py-1.5 text-sm rounded-md border border-workspace-border/60 bg-white focus:border-workspace-accent focus:outline-none"
      />

      <div className="space-y-2">
        {rules.map((r, i) => {
          const needsValue = !NO_VALUE_OPS.includes(r.operator);
          const needsTwoValues = r.operator === 'between';
          return (
            <div key={i} className="flex items-center gap-1.5 flex-wrap">
              {i > 0 && (
                <select
                  value={combinator}
                  onChange={e => setCombinator(e.target.value as 'AND' | 'OR')}
                  className="text-[10px] font-semibold px-1.5 py-1 rounded border border-workspace-accent/40 bg-workspace-accent/5 text-workspace-accent"
                >
                  <option value="AND">AND</option>
                  <option value="OR">OR</option>
                </select>
              )}
              {columns.length > 0 ? (
                <select
                  value={r.column}
                  onChange={e => updateRule(i, { column: e.target.value })}
                  className="text-xs px-2 py-1 rounded border border-workspace-border/60 bg-white min-w-[120px]"
                >
                  <option value="">Column…</option>
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <input
                  value={r.column}
                  onChange={e => updateRule(i, { column: e.target.value })}
                  placeholder="Column"
                  className="text-xs px-2 py-1 rounded border border-workspace-border/60 bg-white w-32"
                />
              )}
              <select
                value={r.operator}
                onChange={e => updateRule(i, { operator: e.target.value as TriggerOperator })}
                className="text-xs px-2 py-1 rounded border border-workspace-border/60 bg-white"
              >
                {OPERATOR_GROUPS.map(g => (
                  <optgroup key={g.label} label={g.label}>
                    {g.ops.map(op => <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>)}
                  </optgroup>
                ))}
              </select>
              {needsValue && (
                <input
                  value={String(r.value ?? '')}
                  onChange={e => updateRule(i, { value: e.target.value })}
                  placeholder={needsTwoValues ? 'min' : 'value'}
                  className="text-xs px-2 py-1 rounded border border-workspace-border/60 bg-white w-24"
                />
              )}
              {needsTwoValues && (
                <input
                  value={String(r.valueMax ?? '')}
                  onChange={e => updateRule(i, { valueMax: e.target.value })}
                  placeholder="max"
                  className="text-xs px-2 py-1 rounded border border-workspace-border/60 bg-white w-24"
                />
              )}
              {rules.length > 1 && (
                <button
                  onClick={() => setRules(prev => prev.filter((_, idx) => idx !== i))}
                  className="text-workspace-text-secondary/40 hover:text-red-500 px-1"
                  title="Remove this rule"
                >×</button>
              )}
            </div>
          );
        })}
        <button
          onClick={() => setRules(prev => [...prev, emptyRule(columns[0] ?? '')])}
          className="text-[11px] text-workspace-accent hover:underline"
        >
          + Add another condition (same column allowed)
        </button>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-workspace-border/40">
        <select
          value={actionType}
          onChange={e => setActionType(e.target.value as 'notify' | 'create_card')}
          className="text-xs px-2 py-1 rounded border border-workspace-border/60 bg-white"
        >
          <option value="notify">◎ Notify in Sherpa</option>
          <option value="create_card">◈ Create card on canvas</option>
        </select>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="text-xs px-3 py-1 rounded text-workspace-text-secondary hover:text-workspace-text"
          >Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs px-3 py-1 rounded bg-workspace-accent text-white hover:bg-workspace-accent/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save trigger'}
          </button>
        </div>
      </div>
    </div>
  );
}
