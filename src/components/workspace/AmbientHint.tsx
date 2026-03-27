import { useState, useEffect } from 'react';

interface AmbientHintProps {
  hint: string;
  onDismiss: () => void;
  onAccept?: () => void;
  acceptLabel?: string;
  delay?: number;
}

/**
 * AmbientHint — inline Sherpa intelligence near relevant objects.
 * Not a chat bubble. A quiet, contextual observation that fades in
 * near where the user is focused.
 */
export function AmbientHint({ hint, onDismiss, onAccept, acceptLabel, delay = 0 }: AmbientHintProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  if (!visible) return null;

  return (
    <div className="animate-[materialize_0.4s_cubic-bezier(0.16,1,0.3,1)_forwards] flex items-center gap-2 rounded-lg bg-workspace-accent-subtle/15 border border-workspace-accent/8 px-3 py-2 mt-2">
      <span className="text-workspace-accent text-[10px] flex-shrink-0">✦</span>
      <p className="text-[11px] text-workspace-text-secondary leading-relaxed flex-1">{hint}</p>
      <div className="flex items-center gap-1 flex-shrink-0">
        {onAccept && (
          <button
            onClick={onAccept}
            className="rounded-md px-2 py-0.5 text-[10px] text-workspace-accent transition-colors hover:bg-workspace-accent/10"
          >
            {acceptLabel || 'Yes'}
          </button>
        )}
        <button
          onClick={onDismiss}
          className="rounded-md px-1.5 py-0.5 text-[10px] text-workspace-text-secondary/40 transition-colors hover:text-workspace-text-secondary"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
