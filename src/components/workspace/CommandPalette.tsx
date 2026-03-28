import { useState, useEffect, useRef, useMemo } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

type PaletteItem =
  | { id: string; kind: 'object'; title: string; meta: string; objectId: string; status: string }
  | { id: string; kind: 'query'; title: string; meta: string; query: string }
  | { id: string; kind: 'command'; title: string; meta: string; value: string };

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { state } = useWorkspace();
  const { processIntent, focusObject, collapseObject, dissolveObject, pinObject } = useWorkspaceActions();
  const [input, setInput] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
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

  const paletteItems = useMemo<PaletteItem[]>(() => {
    if (isActionQuery) {
      return [
        { id: 'cmd-focus', kind: 'command', title: '/focus revenue', meta: 'Jump to a live object', value: '/focus ' },
        { id: 'cmd-collapse', kind: 'command', title: '/collapse risk', meta: 'Tuck a panel away', value: '/collapse ' },
        { id: 'cmd-dissolve', kind: 'command', title: '/dissolve timeline', meta: 'Remove an object', value: '/dissolve ' },
        { id: 'cmd-pin', kind: 'command', title: '/pin brief', meta: 'Keep a panel anchored', value: '/pin ' },
      ];
    }

    if (input.trim()) {
      return filteredObjects.map((obj) => ({
        id: obj.id,
        kind: 'object',
        title: obj.title,
        meta: obj.type,
        objectId: obj.id,
        status: obj.status,
      }));
    }

    return recentIntents
      .filter((intent) => intent.query)
      .map((intent, idx) => ({
        id: `recent-${idx}`,
        kind: 'query',
        title: intent.query!,
        meta: 'Recent query',
        query: intent.query!,
      }));
  }, [filteredObjects, input, isActionQuery, recentIntents]);

  useEffect(() => {
    if (!open) return;
    setSelectedIndex(-1);
  }, [open, input, paletteItems.length]);

  const activatePaletteItem = (item: PaletteItem) => {
    if (item.kind === 'object') {
      focusObject(item.objectId);
      onClose();
      return;
    }

    if (item.kind === 'query') {
      processIntent(item.query);
      onClose();
      return;
    }

    setInput(item.value);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

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
        role="dialog"
        aria-modal="true"
        aria-label="Workspace command palette"
        className="workspace-card-surface relative w-full max-w-xl animate-[materialize_0.2s_cubic-bezier(0.16,1,0.3,1)_forwards] rounded-[28px] border border-workspace-border/55 shadow-[0_24px_80px_rgba(0,0,0,0.12)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-workspace-border/50 px-5 py-4">
          <span className="text-workspace-accent text-sm">✦</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && paletteItems.length > 0) {
                e.preventDefault();
                setSelectedIndex((prev) => (prev < paletteItems.length - 1 ? prev + 1 : 0));
              }
              if (e.key === 'ArrowUp' && paletteItems.length > 0) {
                e.preventDefault();
                setSelectedIndex((prev) => (prev <= 0 ? paletteItems.length - 1 : prev - 1));
              }
              if (e.key === 'Enter') {
                if (selectedIndex >= 0 && paletteItems[selectedIndex]) {
                  e.preventDefault();
                  activatePaletteItem(paletteItems[selectedIndex]);
                  return;
                }
                handleSubmit();
              }
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
              Commands
            </div>
          )}

          {isActionQuery && (
            <>
              {paletteItems.map((item, idx) => (
                <button
                  key={item.id}
                  onClick={() => activatePaletteItem(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`workspace-focus-ring flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all duration-200 workspace-spring ${
                    selectedIndex === idx
                      ? 'bg-workspace-accent/8 shadow-[0_12px_24px_rgba(99,102,241,0.08)]'
                      : 'hover:bg-workspace-surface'
                  }`}
                >
                  <span className="text-[10px] font-medium uppercase tracking-wider text-workspace-accent/60 w-16">
                    {item.meta}
                  </span>
                  <span className="text-sm text-workspace-text">{item.title}</span>
                </button>
              ))}
            </>
          )}

          {!isActionQuery && input.trim() && filteredObjects.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-workspace-text-secondary/50">
                Workspace Objects
              </div>
              {paletteItems.map((item, idx) => (
                <button
                  key={item.id}
                  onClick={() => activatePaletteItem(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`workspace-focus-ring flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all duration-200 workspace-spring ${
                    selectedIndex === idx
                      ? 'bg-workspace-accent/8 shadow-[0_12px_24px_rgba(99,102,241,0.08)]'
                      : 'hover:bg-workspace-surface'
                  }`}
                >
                  <span className="w-16 text-[10px] font-medium uppercase tracking-wider text-workspace-accent/60">
                    {item.meta}
                  </span>
                  <span className="text-sm text-workspace-text">{item.title}</span>
                  <span className={`ml-auto text-[9px] ${item.kind === 'object' && item.status === 'collapsed' ? 'text-workspace-text-secondary/40' : 'text-workspace-accent/40'}`}>
                    {item.kind === 'object' ? item.status : ''}
                  </span>
                </button>
              ))}
            </>
          )}

          {!isActionQuery && !input && paletteItems.length > 0 && (
            <>
              <div className="mt-2 px-3 py-1.5 text-[10px] uppercase tracking-widest text-workspace-text-secondary/50">
                Recent Queries
              </div>
              {paletteItems.map((item, idx) => (
                <button
                  key={item.id}
                  onClick={() => activatePaletteItem(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`workspace-focus-ring flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all duration-200 workspace-spring ${
                    selectedIndex === idx
                      ? 'bg-workspace-accent/8 shadow-[0_12px_24px_rgba(99,102,241,0.08)]'
                      : 'hover:bg-workspace-surface'
                  }`}
                >
                  <span className="text-workspace-text-secondary/30 text-xs">→</span>
                  <span className="text-sm text-workspace-text-secondary">{item.title}</span>
                </button>
              ))}
            </>
          )}

          {!isActionQuery && input.trim() && filteredObjects.length === 0 && (
            <div className="mx-2 my-2 rounded-2xl border border-workspace-border/50 bg-white/70 px-4 py-4 text-left shadow-[0_12px_24px_rgba(15,23,42,0.04)]">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.22em] text-workspace-accent/70">
                No direct object match
              </div>
              <p className="text-sm text-workspace-text">Nothing in the workspace matches “{input.trim()}”.</p>
              <p className="mt-1 text-xs leading-5 text-workspace-text-secondary/70">
                Press <span className="font-medium text-workspace-text">Enter</span> to ask Sherpa directly, or use arrow keys to browse when results appear.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-workspace-border/30 px-5 py-2.5 flex items-center justify-between text-[10px] text-workspace-text-secondary/40">
          <span>Type naturally to ask Sherpa</span>
          <span>↑↓ to browse · ↵ to submit</span>
        </div>
      </div>
    </div>
  );
}
