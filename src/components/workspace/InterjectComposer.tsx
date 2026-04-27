/**
 * InterjectComposer — mid-loop steering surface for an in-flight agent.
 *
 * Renders below the ThinkingStrip while `useAgentEvents().isLive` is true.
 * Lets the user push a steering message into the agent's iteration boundary
 * (drained on the next iteration) or hard-stop the loop entirely.
 *
 * Composer is intentionally compact: a single thin row with input + send
 * + stop. Doesn't expand the visual footprint when there's nothing to do.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useAgentEvents } from '@/hooks/useAgentEvents';
import { pushInterjection, requestStop, pendingInterjectionCount } from '@/lib/agent-interjection';

export function InterjectComposer() {
  const { isLive } = useAgentEvents();
  const [input, setInput] = useState('');
  const [queuedFlash, setQueuedFlash] = useState(false);
  const [pending, setPending] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<number | null>(null);

  // Poll pending count every 600ms while live (cheap, no event channel needed)
  useEffect(() => {
    if (!isLive) {
      setPending(0);
      return;
    }
    const id = window.setInterval(() => setPending(pendingInterjectionCount()), 600);
    return () => window.clearInterval(id);
  }, [isLive]);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    pushInterjection(trimmed);
    setInput('');
    setQueuedFlash(true);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setQueuedFlash(false), 1800);
  }, [input]);

  const handleStop = useCallback(() => {
    requestStop('User pressed Stop');
    setInput('');
  }, []);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      handleStop();
    }
  }, [handleSubmit, handleStop]);

  if (!isLive) return null;

  return (
    <div className="mt-1 flex items-center gap-1.5 rounded-lg border border-workspace-accent/25 bg-white/55 px-2 py-1 transition-all animate-[materialize_0.28s_cubic-bezier(0.16,1,0.3,1)]">
      <span className="text-workspace-accent/55 text-[10px] shrink-0" title="Steer Sherpa mid-loop">⟶</span>
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Steer mid-loop... (Enter to send, Esc to stop)"
        className="flex-1 bg-transparent text-[11px] text-workspace-text placeholder:text-workspace-text-secondary/40 outline-none min-w-0"
      />
      {(queuedFlash || pending > 0) && (
        <span
          className={`text-[9px] tabular-nums px-1.5 py-0.5 rounded-full border transition-all ${
            queuedFlash
              ? 'border-emerald-300/55 bg-emerald-50/65 text-emerald-700/85'
              : 'border-workspace-border/40 bg-workspace-surface/55 text-workspace-text-secondary/65'
          }`}
          title={queuedFlash ? 'Added to next iteration' : `${pending} interjection${pending === 1 ? '' : 's'} queued`}
        >
          {queuedFlash ? '→ added' : `${pending} queued`}
        </span>
      )}
      {input.trim().length > 0 && (
        <button
          onClick={handleSubmit}
          className="rounded-md border border-workspace-accent/35 bg-workspace-accent/10 px-2 py-0.5 text-[10px] font-medium text-workspace-accent hover:bg-workspace-accent/15 transition-colors shrink-0"
          title="Send to Sherpa's next iteration"
        >
          Send
        </button>
      )}
      <button
        onClick={handleStop}
        className="rounded-md border border-rose-300/45 bg-rose-50/35 px-2 py-0.5 text-[10px] font-medium text-rose-700/80 hover:bg-rose-100/55 transition-colors shrink-0"
        title="Stop the agent loop now"
      >
        ⏹
      </button>
    </div>
  );
}
