import { useState, useEffect } from 'react';
import { DataProfile, getCurrentProfile, clearProfileCache } from '@/lib/data-analyzer';
import { getActiveDataset } from '@/lib/active-dataset';
import { refineDataRules, invalidateProfileCache } from '@/lib/intent-engine';
import { describeRankingLogic } from '@/lib/data-slicer';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { previewRows, alertRows, metricAggregate, comparisonPairs } from '@/lib/data-slicer';

export function RulesEditor({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useWorkspace();
  const [profile, setProfile] = useState<DataProfile | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [customInstruction, setCustomInstruction] = useState('');

  useEffect(() => {
    const ds = getActiveDataset();
    const p = getCurrentProfile(ds.columns, ds.rows);
    setProfile(p);
  }, []);

  const refreshCards = (updated: DataProfile) => {
    const { columns, rows } = getActiveDataset();
    const dataObjects = Object.values(state.objects).filter(
      o => ['metric', 'inspector', 'alert', 'comparison'].includes(o.type) && o.status !== 'dissolved'
    );
    for (const obj of dataObjects) {
      let newContext: Record<string, any> = obj.context;
      switch (obj.type) {
        case 'metric': {
          const agg = metricAggregate(columns, rows, updated);
          newContext = { ...obj.context, ...agg };
          break;
        }
        case 'inspector': {
          const preview = previewRows(columns, rows, updated, 8);
          newContext = { columns: preview.columns, rows: preview.rows };
          break;
        }
        case 'alert': {
          const alerts = alertRows(columns, rows, updated);
          newContext = { alerts };
          break;
        }
        case 'comparison': {
          const comp = comparisonPairs(columns, rows, updated);
          newContext = comp;
          break;
        }
      }
      dispatch({ type: 'UPDATE_OBJECT_CONTEXT', payload: { id: obj.id, context: newContext } });
    }
  };

  const handleCustomRefine = async () => {
    if (!customInstruction.trim()) return;
    setIsRefining(true);
    try {
      const updated = await refineDataRules(customInstruction);
      setProfile(updated);
      refreshCards(updated);
      setCustomInstruction('');
      dispatch({
        type: 'SET_SHERPA_RESPONSE',
        payload: `Rules updated based on your instruction. Cards refreshed.`,
      });
    } catch (e) { console.error('[RulesEditor] Failed to refine data rules:', e); }
    setIsRefining(false);
  };

  const handleReset = () => {
    clearProfileCache();
    invalidateProfileCache();
    setProfile(null);
    dispatch({
      type: 'SET_SHERPA_RESPONSE',
      payload: 'Rules reset to defaults. Next data request will re-analyze the dataset.',
    });
  };

  if (!profile) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-workspace-text-secondary">
          No active profile yet. Request data (e.g. "show AP exposure") to generate one.
        </p>
        <button onClick={onClose} className="text-[10px] text-workspace-accent hover:underline">
          Close
        </button>
      </div>
    );
  }

  const rules = [
    { key: 'primaryMeasureColumn', label: 'Sort by', value: profile.primaryMeasureColumn },
    { key: 'sortDirection', label: 'Direction', value: profile.sortDirection === 'desc' ? 'Highest first' : 'Lowest first' },
    { key: 'groupByColumn', label: 'Group by', value: profile.groupByColumn || '—' },
    {
      key: 'ordinalPriorityColumn',
      label: 'Priority column',
      value: profile.ordinalPriorityColumn
        ? `${profile.ordinalPriorityColumn.column} (${profile.ordinalPriorityColumn.rankOrder.length} ranks)`
        : '— none detected',
    },
    {
      key: 'urgencySignal',
      label: 'Urgency signal',
      value: profile.urgencySignal
        ? `${profile.urgencySignal.column}: ${profile.urgencySignal.hotValues.slice(0, 2).join(', ')}`
        : '— none',
    },
  ];

  return (
    <div className="space-y-3 animate-[materialize_0.3s_cubic-bezier(0.16,1,0.3,1)_forwards]">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-widest text-workspace-accent/60 font-medium">
          Active Rules
        </span>
        <button onClick={onClose} className="text-[10px] text-workspace-text-secondary/40 hover:text-workspace-text-secondary">
          ✕
        </button>
      </div>

      <div className="space-y-1.5">
        {rules.map(rule => (
          <div
            key={rule.key}
            className="flex items-center justify-between rounded-md bg-workspace-surface/40 px-2.5 py-1.5 text-[11px]"
          >
            <span className="text-workspace-text-secondary">{rule.label}</span>
            <span className="font-medium text-workspace-text">{rule.value}</span>
          </div>
        ))}
      </div>

      {profile.ordinalPriorityColumn && (
        <div className="rounded-md border border-workspace-accent/10 bg-workspace-accent/[0.03] px-2.5 py-2">
          <div className="text-[9px] uppercase tracking-wider text-workspace-accent/50 mb-1">Rank Order</div>
          <div className="space-y-0.5">
            {profile.ordinalPriorityColumn.rankOrder.map((rank, i) => (
              <div key={rank} className="flex items-center gap-1.5 text-[10px]">
                <span className="text-workspace-text-secondary/40 tabular-nums w-3">{i + 1}.</span>
                <span className="text-workspace-text">{rank}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ranking logic description */}
      <div className="rounded-md bg-workspace-surface/30 px-2.5 py-2">
        <div className="text-[9px] uppercase tracking-wider text-workspace-text-secondary/50 mb-1">Sorting Logic</div>
        <p className="text-[10px] text-workspace-text-secondary leading-relaxed">
          {describeRankingLogic(profile)}
        </p>
      </div>

      {!profile.ordinalPriorityColumn && (
      <div className="rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-2">
          <p className="text-[10px] text-destructive/80 leading-relaxed">
            ⚠ No explicit priority column detected. The current ranking is provisional. 
            You can define one by saying e.g. "use Status column as priority" or "Tier 1 is highest priority".
          </p>
        </div>
      )}

      <div className="text-[10px] text-workspace-text-secondary/60 italic leading-relaxed">
        "{profile.previewStrategy}"
      </div>

      {/* Custom instruction */}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={customInstruction}
          onChange={e => setCustomInstruction(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCustomRefine()}
          placeholder="Change rules: e.g. 'sort by name'"
          className="flex-1 rounded-md border border-workspace-border bg-white px-2 py-1.5 text-[11px] text-workspace-text
            placeholder:text-workspace-text-secondary/30 outline-none focus:border-workspace-accent/30"
        />
        <button
          onClick={handleCustomRefine}
          disabled={isRefining || !customInstruction.trim()}
          className="rounded-md bg-workspace-accent/10 px-2 py-1.5 text-[10px] font-medium text-workspace-accent
            hover:bg-workspace-accent/20 disabled:opacity-40 transition-colors"
        >
          {isRefining ? '...' : 'Apply'}
        </button>
      </div>

      <button
        onClick={handleReset}
        className="text-[10px] text-destructive/60 hover:text-destructive transition-colors"
      >
        Reset to auto-detected rules
      </button>
    </div>
  );
}
