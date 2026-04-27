/**
 * ErrorTray — failure-recovery affordance below errored Sherpa responses.
 *
 * Renders Retry / Edit / Details buttons when an agent loop returned an
 * AgentError. Each error code maps to a slightly different message tone
 * but the affordances are the same:
 *
 *   - Retry: re-fire the original query (with original images)
 *   - Edit:  load the original query into the composer for editing
 *   - Details: collapsible disclosure showing the AgentError.detail string
 */
import { useState } from 'react';

export interface ErrorTrayProps {
  error: { code: string; message: string; detail?: string };
  onRetry: () => void;
  onEdit: () => void;
}

const CODE_TONE: Record<string, { ring: string; bg: string; icon: string; iconColor: string }> = {
  no_response:       { ring: 'border-rose-300/50',   bg: 'bg-rose-50/35',   icon: '⊘', iconColor: 'text-rose-600/80' },
  provider_switch:   { ring: 'border-amber-300/50',  bg: 'bg-amber-50/35',  icon: '⇆', iconColor: 'text-amber-700/80' },
  stuck_loop:        { ring: 'border-amber-300/50',  bg: 'bg-amber-50/35',  icon: '↻', iconColor: 'text-amber-700/80' },
  max_iterations:    { ring: 'border-amber-300/50',  bg: 'bg-amber-50/35',  icon: '∞', iconColor: 'text-amber-700/80' },
  exception:         { ring: 'border-rose-300/50',   bg: 'bg-rose-50/35',   icon: '!', iconColor: 'text-rose-600/80' },
  image_unsupported: { ring: 'border-blue-300/50',   bg: 'bg-blue-50/35',   icon: '◇', iconColor: 'text-blue-600/80' },
};

const FALLBACK_TONE = { ring: 'border-rose-300/50', bg: 'bg-rose-50/35', icon: '!', iconColor: 'text-rose-600/80' };

export function ErrorTray({ error, onRetry, onEdit }: ErrorTrayProps) {
  const [showDetails, setShowDetails] = useState(false);
  const tone = CODE_TONE[error.code] || FALLBACK_TONE;

  return (
    <div
      className={`mt-1 rounded-2xl rounded-bl-md border ${tone.ring} ${tone.bg} px-3.5 py-2.5 animate-[materialize_0.32s_cubic-bezier(0.16,1,0.3,1)]`}
    >
      <div className="flex items-start gap-2">
        <span className={`text-base leading-none mt-0.5 ${tone.iconColor}`}>{tone.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-workspace-text leading-snug font-medium">{error.message}</p>
          {showDetails && error.detail && (
            <p className="mt-1.5 text-[10px] text-workspace-text-secondary/75 leading-relaxed font-mono bg-white/45 rounded px-2 py-1.5 animate-[materialize_0.24s_ease-out]">
              {error.detail}
            </p>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <button
              onClick={onRetry}
              className="rounded-md border border-workspace-accent/30 bg-white/55 px-2.5 py-1 text-[10px] font-medium text-workspace-accent hover:bg-workspace-accent/10 hover:border-workspace-accent/50 transition-colors"
            >
              ↻ Retry
            </button>
            <button
              onClick={onEdit}
              className="rounded-md border border-workspace-border/40 bg-white/40 px-2.5 py-1 text-[10px] font-medium text-workspace-text-secondary hover:text-workspace-text hover:bg-white/65 transition-colors"
            >
              ✎ Edit & resend
            </button>
            {error.detail && (
              <button
                onClick={() => setShowDetails(s => !s)}
                className="ml-auto text-[10px] text-workspace-text-secondary/60 hover:text-workspace-text-secondary transition-colors"
              >
                {showDetails ? 'Hide details' : 'Details'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
