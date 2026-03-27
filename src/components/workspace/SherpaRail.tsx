import { useState, useRef } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { useSherpa } from '@/contexts/SherpaContext';

export function SherpaRail() {
  const { state } = useWorkspace();
  const { processIntent } = useWorkspaceActions();
  const { suggestions, observations, lastResponse, isProcessing } = useSherpa();
  const [input, setInput] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    processIntent(trimmed);
    setInput('');
  };

  const handleSuggestionClick = (query: string) => {
    processIntent(query);
  };

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="fixed right-4 top-4 z-50 rounded-full bg-white border border-workspace-border px-4 py-2
          text-xs text-workspace-accent shadow-sm transition-all hover:shadow-md"
      >
        ✦ Sherpa
      </button>
    );
  }

  return (
    <div className="flex h-full w-80 flex-shrink-0 flex-col border-l border-workspace-border/50 bg-white/80 backdrop-blur-sm lg:w-[340px]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-workspace-accent text-sm">✦</span>
          <span className="text-xs font-semibold uppercase tracking-widest text-workspace-text">
            Sherpa
          </span>
        </div>
        <button
          onClick={() => setIsExpanded(false)}
          className="rounded-md p-1 text-workspace-text-secondary transition-colors hover:bg-workspace-surface text-xs"
        >
          ▸
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5">
        {/* Greeting / Response area — NOT chat bubbles (anti-drift) */}
        <div className="space-y-4 pb-4">
          {!lastResponse && (
            <div className="animate-[materialize_0.5s_cubic-bezier(0.16,1,0.3,1)_forwards]">
              <p className="text-sm leading-relaxed text-workspace-text">
                Good morning. What would you like to focus on?
              </p>
              <p className="mt-2 text-xs text-workspace-text-secondary">
                I can surface metrics, compare entities, highlight risks, or prepare a brief.
              </p>
            </div>
          )}

          {lastResponse && (
            <div
              key={lastResponse}
              className="animate-[materialize_0.3s_cubic-bezier(0.16,1,0.3,1)_forwards]"
            >
              <p className="text-sm leading-relaxed text-workspace-text">{lastResponse}</p>
            </div>
          )}

          {/* Proactive observations — the Sherpa noticing things */}
          {observations.length > 0 && (
            <div className="space-y-2 border-t border-workspace-border/30 pt-3">
              <span className="text-[9px] uppercase tracking-widest text-workspace-accent/50">
                Noticed
              </span>
              {observations.slice(-3).map((obs, i) => (
                <div
                  key={i}
                  className="animate-[materialize_0.4s_cubic-bezier(0.16,1,0.3,1)_forwards] rounded-lg bg-workspace-accent-subtle/20 px-3 py-2"
                >
                  <p className="text-[11px] text-workspace-text-secondary leading-relaxed">
                    {obs}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Suggestion chips */}
        <div className="space-y-2 pb-4">
          {suggestions.map((s) => (
            <button
              key={s.id}
              onClick={() => handleSuggestionClick(s.query)}
              className="block w-full rounded-lg border border-workspace-border/60 bg-workspace-surface/30 px-3.5 py-2.5
                text-left text-xs text-workspace-text transition-all duration-200
                hover:border-workspace-accent/20 hover:bg-workspace-accent-subtle/30 hover:shadow-sm"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input area — bottom of rail */}
      <div className="border-t border-workspace-border/50 p-4">
        <div className="flex items-center gap-2 rounded-xl border border-workspace-border bg-white px-3.5 py-2.5
          transition-all focus-within:border-workspace-accent/30 focus-within:shadow-sm">
          <span className="text-workspace-accent/40 text-sm">→</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="Ask anything..."
            className="flex-1 bg-transparent text-sm text-workspace-text placeholder:text-workspace-text-secondary/40
              outline-none"
          />
          {isProcessing && (
            <div className="h-3 w-3 rounded-full border-2 border-workspace-accent/30 border-t-workspace-accent animate-spin" />
          )}
        </div>
      </div>
    </div>
  );
}
