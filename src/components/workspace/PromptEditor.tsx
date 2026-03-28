/**
 * PromptEditor — admin panel for viewing and editing every system prompt.
 *
 * Shows all 14+ prompts grouped by category. Each prompt can be:
 * - Viewed (the server default is fetched and displayed)
 * - Edited (override stored in localStorage, sent to edge function)
 * - Reverted (override cleared, returns to server default)
 *
 * Renders in the SherpaRail admin section.
 */
import { useState, useCallback, useEffect } from 'react';
import {
  PROMPT_REGISTRY,
  getPromptOverride,
  setPromptOverride,
  clearPromptOverride,
  hasOverride,
  clearAllOverrides,
} from '@/lib/system-prompts';

const CATEGORY_LABELS: Record<string, string> = {
  core: 'Core Intelligence',
  enrichment: 'Content Generation',
  cfo: 'CFO Object Types',
  utility: 'Data & Utilities',
};

const CATEGORY_ORDER = ['core', 'enrichment', 'cfo', 'utility'];

export function PromptEditor() {
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [serverDefaults, setServerDefaults] = useState<Record<string, string>>({});
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  const [overrideCount, setOverrideCount] = useState(
    PROMPT_REGISTRY.filter(p => hasOverride(p.id)).length
  );

  // Fetch server defaults from the edge function
  const fetchDefaults = useCallback(async () => {
    setLoadingDefaults(true);
    try {
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: '__list-prompts' }),
        }
      );
      if (resp.ok) {
        const data = await resp.json();
        if (data.prompts) setServerDefaults(data.prompts);
      }
    } catch (e) {
      console.warn('[PromptEditor] Could not fetch server defaults:', e);
    }
    setLoadingDefaults(false);
  }, []);

  useEffect(() => { fetchDefaults(); }, [fetchDefaults]);

  const openPrompt = (id: string) => {
    setActivePromptId(id);
    const override = getPromptOverride(id);
    setEditText(override || serverDefaults[id] || '(Loading server default...)');
  };

  const saveOverride = () => {
    if (!activePromptId || !editText.trim()) return;
    setPromptOverride(activePromptId, editText);
    setOverrideCount(PROMPT_REGISTRY.filter(p => hasOverride(p.id)).length);
  };

  const revertToDefault = () => {
    if (!activePromptId) return;
    clearPromptOverride(activePromptId);
    setEditText(serverDefaults[activePromptId] || '');
    setOverrideCount(PROMPT_REGISTRY.filter(p => hasOverride(p.id)).length);
  };

  const revertAll = () => {
    clearAllOverrides();
    setOverrideCount(0);
    if (activePromptId) {
      setEditText(serverDefaults[activePromptId] || '');
    }
  };

  // Grouped prompts
  const grouped = CATEGORY_ORDER.map(cat => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    prompts: PROMPT_REGISTRY.filter(p => p.category === cat),
  }));

  if (activePromptId) {
    const promptDef = PROMPT_REGISTRY.find(p => p.id === activePromptId);
    const isOverridden = hasOverride(activePromptId);
    const charCount = editText.length;
    const wordCount = editText.split(/\s+/).filter(Boolean).length;

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setActivePromptId(null)}
            className="text-[11px] text-workspace-text-secondary hover:text-workspace-accent transition-colors"
          >
            ← Back to prompts
          </button>
          {isOverridden && (
            <span className="text-[9px] uppercase tracking-wider text-amber-500 font-medium">Custom Override</span>
          )}
        </div>

        <div>
          <div className="text-xs font-medium text-workspace-text">{promptDef?.label}</div>
          <div className="text-[10px] text-workspace-text-secondary/60 mt-0.5">{promptDef?.description}</div>
        </div>

        <textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          className="w-full h-[320px] rounded-xl border border-workspace-border/50 bg-white px-3 py-2.5 text-[11px] font-mono leading-relaxed text-workspace-text placeholder:text-workspace-text-secondary/40 outline-none resize-y transition-all focus:border-workspace-accent/30 focus:shadow-[0_8px_20px_rgba(99,102,241,0.08)]"
          spellCheck={false}
        />

        <div className="flex items-center justify-between text-[9px] text-workspace-text-secondary/50 tabular-nums">
          <span>{charCount.toLocaleString()} chars · {wordCount} words</span>
          <span>~{Math.ceil(charCount / 4)} tokens</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={saveOverride}
            className="flex-1 rounded-xl bg-workspace-accent/10 px-3 py-2 text-[11px] font-medium text-workspace-accent transition-all hover:bg-workspace-accent/20"
          >
            Save Override
          </button>
          <button
            onClick={revertToDefault}
            className="rounded-xl border border-workspace-border/40 px-3 py-2 text-[11px] text-workspace-text-secondary transition-all hover:border-red-300 hover:text-red-500"
          >
            Revert to Default
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/75">
            System Prompts
          </div>
          <p className="text-[11px] text-workspace-text-secondary tabular-nums mt-0.5">
            {PROMPT_REGISTRY.length} prompts{overrideCount > 0 ? ` · ${overrideCount} customized` : ''}
          </p>
        </div>
        {overrideCount > 0 && (
          <button
            onClick={revertAll}
            className="text-[10px] text-workspace-text-secondary/50 hover:text-red-500 transition-colors"
          >
            Revert all
          </button>
        )}
      </div>

      {loadingDefaults && (
        <p className="text-[10px] text-workspace-text-secondary/50">Loading server defaults...</p>
      )}

      {grouped.map(({ category, label, prompts }) => (
        <div key={category}>
          <div className="text-[9px] uppercase tracking-wider text-workspace-text-secondary/40 font-medium mb-1.5">
            {label}
          </div>
          <div className="space-y-1">
            {prompts.map(p => {
              const isOverridden = hasOverride(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => openPrompt(p.id)}
                  className={`group block w-full rounded-lg px-3 py-2 text-left transition-all ${
                    isOverridden
                      ? 'border border-amber-200/50 bg-amber-50/20 hover:border-amber-300/50'
                      : 'border border-workspace-border/30 bg-workspace-surface/10 hover:border-workspace-accent/20 hover:bg-workspace-accent/5'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-workspace-text">{p.label}</span>
                    <div className="flex items-center gap-1.5">
                      {isOverridden && (
                        <span className="text-[8px] uppercase tracking-wider text-amber-500 font-medium">Custom</span>
                      )}
                      <span className="text-[10px] text-workspace-text-secondary/30 group-hover:text-workspace-accent transition-colors">→</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-workspace-text-secondary/60">{p.description}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
