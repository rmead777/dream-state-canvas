import { useState, useEffect, useRef, useMemo } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { state } = useWorkspace();
  const { processIntent, focusObject, collapseObject, dissolveObject, pinObject } = useWorkspaceActions();
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setInput('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const activeObjects = useMemo(
    () => Object.values(state.objects).filter((o) => o.status !== 'dissolved'),
    [state.objects]
  );

  const filteredObjects = useMemo(() => {
    if (!input.trim()) return activeObjects.slice(0, 5);
    const lower = input.toLowerCase();
    return activeObjects.filter(
      (o) => o.title.toLowerCase().includes(lower) || o.type.includes(lower)
    );
  }, [input, activeObjects]);

  const isActionQuery = input.startsWith('/');
  const recentIntents = state.activeContext.recentIntents.slice(-3);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Quick actions
    if (trimmed.startsWith('/focus ')) {
      const name = trimmed.slice(7).toLowerCase();
      const obj = activeObjects.find((o) => o.title.toLowerCase().includes(name));
      if (obj) focusObject(obj.id);
    } else if (trimmed.startsWith('/collapse ')) {
      const name = trimmed.slice(10).toLowerCase();
      const obj = activeObjects.find((o) => o.title.toLowerCase().includes(name));
      if (obj) collapseObject(obj.id);
    } else if (trimmed.startsWith('/dissolve ')) {
      const name = trimmed.slice(10).toLowerCase();
      const obj = activeObjects.find((o) => o.title.toLowerCase().includes(name));
      if (obj) dissolveObject(obj.id);
    } else if (trimmed.startsWith('/pin ')) {
      const name = trimmed.slice(5).toLowerCase();
      const obj = activeObjects.find((o) => o.title.toLowerCase().includes(name));
      if (obj) pinObject(obj.id);
    } else {
      processIntent(trimmed);
    }

    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-workspace-text/10 backdrop-blur-sm animate-[materialize_0.15s_cubic-bezier(0.34,1.56,0.64,1)_forwards]" />
      <div
        className="relative w-full max-w-xl animate-[materialize_0.2s_cubic-bezier(0.16,1,0.3,1)_forwards] rounded-2xl border border-workspace-border bg-white shadow-[0_24px_80px_rgba(0,0,0,0.12)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-workspace-border/50">
          <span className="text-workspace-accent text-sm">✦</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
              if (e.key === 'Escape') onClose();
            }}
            placeholder="Ask anything, or type / for commands..."
            className="flex-1 bg-transparent text-sm text-workspace-text placeholder:text-workspace-text-secondary/40 outline-none"
          />
          <kbd className="hidden sm:block rounded-md border border-workspace-border px-1.5 py-0.5 text-[10px] text-workspace-text-secondary">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-64 overflow-y-auto px-2 py-2">
          {isActionQuery && (
            <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-workspace-text-secondary/50">
              Commands: /focus, /collapse, /dissolve, /pin
            </div>
          )}

          {!isActionQuery && filteredObjects.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-workspace-text-secondary/50">
                Workspace Objects
              </div>
              {filteredObjects.map((obj) => (
                <button
                  key={obj.id}
                  onClick={() => { focusObject(obj.id); onClose(); }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-workspace-surface"
                >
                  <span className="text-[10px] font-medium uppercase tracking-wider text-workspace-accent/60 w-16">
                    {obj.type}
                  </span>
                  <span className="text-sm text-workspace-text">{obj.title}</span>
                  <span className={`ml-auto text-[9px] ${obj.status === 'collapsed' ? 'text-workspace-text-secondary/40' : 'text-workspace-accent/40'}`}>
                    {obj.status}
                  </span>
                </button>
              ))}
            </>
          )}

          {!input && recentIntents.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-workspace-text-secondary/50 mt-2">
                Recent Queries
              </div>
              {recentIntents.filter((i) => i.query).map((intent, idx) => (
                <button
                  key={idx}
                  onClick={() => { processIntent(intent.query!); onClose(); }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-workspace-surface"
                >
                  <span className="text-workspace-text-secondary/30 text-xs">→</span>
                  <span className="text-sm text-workspace-text-secondary">{intent.query}</span>
                </button>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-workspace-border/30 px-5 py-2.5 flex items-center justify-between text-[10px] text-workspace-text-secondary/40">
          <span>Type naturally to ask Sherpa</span>
          <span>↵ to submit</span>
        </div>
      </div>
    </div>
  );
}
