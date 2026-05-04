/**
 * MemoryPanel — displays Sherpa's learned memories with management controls.
 * Renders in the SherpaRail admin section.
 *
 * Shows: corrections, preferences, entities, patterns, anti-patterns
 * Controls: confirm/dismiss pending, delete any, clear all
 */
import { useState, useEffect, useCallback } from 'react';
import { SherpaMemory } from '@/lib/memory-types';
import { getMemories, getPendingMemories, confirmMemory, deleteMemory } from '@/lib/memory-store';
import { supabase } from '@/integrations/supabase/client';
import { CloneProfileModal } from './CloneProfileModal';

const TYPE_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  correction: { icon: '✓', label: 'Corrections', color: 'text-red-500' },
  preference: { icon: '◆', label: 'Preferences', color: 'text-workspace-accent' },
  entity: { icon: '◇', label: 'Domain Knowledge', color: 'text-emerald-500' },
  pattern: { icon: '○', label: 'Patterns', color: 'text-blue-500' },
  'anti-pattern': { icon: '✕', label: 'Avoid', color: 'text-amber-500' },
};

interface MemoryPanelProps {
  onSendToSherpa?: (message: string) => void;
}

export function MemoryPanel({ onSendToSherpa }: MemoryPanelProps) {
  const [memories, setMemories] = useState<SherpaMemory[]>([]);
  const [pending, setPending] = useState<SherpaMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);

  const loadMemories = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [allMems, pendingMems] = await Promise.all([
      getMemories(user.id),
      getPendingMemories(user.id),
    ]);
    setMemories(allMems);
    setPending(pendingMems);
    setLoading(false);
  }, []);

  useEffect(() => { loadMemories(); }, [loadMemories]);

  const handleConfirm = async (id: string) => {
    await confirmMemory(id);
    loadMemories();
  };

  const handleDelete = async (id: string) => {
    await deleteMemory(id);
    loadMemories();
  };

  if (loading) {
    return (
      <div className="py-4 text-center text-xs text-workspace-text-secondary/50">
        Loading memories...
      </div>
    );
  }

  const grouped = memories.reduce<Record<string, SherpaMemory[]>>((acc, m) => {
    (acc[m.type] = acc[m.type] || []).push(m);
    return acc;
  }, {});

  const pendingIds = new Set(pending.map(p => p.id));
  const totalCount = memories.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/75">
            Sherpa Memory
          </span>
          <p className="text-[11px] text-workspace-text-secondary tabular-nums">
            {totalCount} {totalCount === 1 ? 'memory' : 'memories'}
            {pending.length > 0 && ` · ${pending.length} pending`}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {totalCount > 3 && onSendToSherpa && (
            <button
              onClick={() => {
                setCleaningUp(true);
                onSendToSherpa(
                  `Review ALL of my stored memories (use recallMemories with a broad query to see them all). Identify redundant, duplicate, or obsolete entries. Then use consolidateMemories to propose: (1) which memories to delete and why, (2) consolidated replacements that merge redundant entries into clean, non-repetitive preferences. Be aggressive — if 5 memories say the same thing about frosted charts, merge them into one.`
                );
                setTimeout(() => setCleaningUp(false), 3000);
              }}
              disabled={cleaningUp}
              className="rounded-full border border-purple-200/50 bg-purple-50/30 px-2.5 py-1 text-[10px] font-medium text-purple-600 transition-colors hover:bg-purple-100/40 disabled:opacity-50"
            >
              {cleaningUp ? 'Cleaning...' : 'Clean Up'}
            </button>
          )}
          <button
            onClick={() => setCloneOpen(true)}
            className="rounded-full border border-workspace-accent/30 bg-workspace-accent/10 px-2.5 py-1 text-[10px] font-medium text-workspace-accent transition-colors hover:bg-workspace-accent/20"
            title="Copy your tuned Sherpa (memories + documents) to another user"
          >
            Clone to User…
          </button>
        </div>
      </div>

      {/* Pending confirmation */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-amber-500/80">
            Pending Confirmation
          </span>
          {pending.map(m => (
            <div key={m.id} className="rounded-xl border border-amber-200/50 bg-amber-50/30 px-3 py-2.5 space-y-1.5">
              <p className="text-xs text-workspace-text leading-relaxed">{m.content}</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleConfirm(m.id)}
                  className="rounded-full bg-workspace-accent/10 px-2.5 py-1 text-[10px] font-medium text-workspace-accent transition-colors hover:bg-workspace-accent/20"
                >
                  Confirm
                </button>
                <button
                  onClick={() => handleDelete(m.id)}
                  className="rounded-full px-2.5 py-1 text-[10px] text-workspace-text-secondary transition-colors hover:text-red-500"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Grouped memories by type */}
      {Object.entries(TYPE_CONFIG).map(([type, config]) => {
        const items = (grouped[type] || []).filter(m => !pendingIds.has(m.id));
        if (items.length === 0) return null;

        return (
          <div key={type} className="space-y-1.5">
            <span className={`text-[10px] font-medium uppercase tracking-wider ${config.color}/80`}>
              {config.label} ({items.length})
            </span>
            {items.map(m => (
              <div
                key={m.id}
                className="group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-workspace-surface/50"
              >
                <span className={`mt-0.5 text-xs ${config.color}`}>{config.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-workspace-text leading-relaxed truncate" title={m.content}>
                    {m.content}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-workspace-text-secondary/50 tabular-nums">
                      {Math.round(m.confidence * 100)}%
                    </span>
                    {m.hitCount > 0 && (
                      <span className="text-[10px] text-workspace-text-secondary/50 tabular-nums">
                        {m.hitCount}×
                      </span>
                    )}
                    {m.source === 'confirmed' && (
                      <span className="text-[9px] text-emerald-500/70">confirmed</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(m.id)}
                  className="shrink-0 rounded p-1 text-[10px] text-workspace-text-secondary/30 opacity-0 transition-all group-hover:opacity-100 hover:text-red-500"
                  title="Delete memory"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        );
      })}

      {totalCount === 0 && (
        <p className="py-4 text-center text-xs text-workspace-text-secondary/50">
          No memories yet. Sherpa will learn from your interactions over time.
        </p>
      )}

      <CloneProfileModal open={cloneOpen} onClose={() => setCloneOpen(false)} />
    </div>
  );
}
