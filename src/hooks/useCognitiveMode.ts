import { useEffect, useState, useRef } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export type CognitiveMode = 'neutral' | 'research' | 'analysis' | 'decision' | 'synthesis';

const MODE_VARS: Record<CognitiveMode, Record<string, string>> = {
  neutral: {
    '--workspace-bg': '40 20% 98%',
    '--workspace-accent': '234 60% 60%',
    '--workspace-surface': '40 15% 96%',
  },
  research: {
    '--workspace-bg': '38 25% 97%',
    '--workspace-accent': '28 70% 55%',
    '--workspace-surface': '38 20% 95%',
  },
  analysis: {
    '--workspace-bg': '220 20% 97%',
    '--workspace-accent': '220 65% 55%',
    '--workspace-surface': '220 15% 95%',
  },
  decision: {
    '--workspace-bg': '0 10% 98%',
    '--workspace-accent': '0 60% 55%',
    '--workspace-surface': '0 8% 96%',
  },
  synthesis: {
    '--workspace-bg': '160 15% 98%',
    '--workspace-accent': '160 40% 45%',
    '--workspace-surface': '160 12% 96%',
  },
};

export function useCognitiveMode(): CognitiveMode {
  const { state } = useWorkspace();
  const [mode, setMode] = useState<CognitiveMode>('neutral');
  const prevMode = useRef<CognitiveMode>('neutral');

  useEffect(() => {
    const objects = Object.values(state.objects).filter((o) => o.status !== 'dissolved');
    const open = objects.filter((o) => o.status === 'open' || o.status === 'materializing');

    let detected: CognitiveMode = 'neutral';

    // Immersive → analysis
    if (state.activeContext.immersiveObjectId) {
      detected = 'analysis';
    }
    // Alerts or comparisons → decision
    else if (open.some((o) => o.type === 'alert') && open.some((o) => o.type === 'comparison' || o.type === 'metric')) {
      detected = 'decision';
    }
    // Brief generation → synthesis
    else if (open.some((o) => o.type === 'brief')) {
      detected = 'synthesis';
    }
    // Multiple objects open → research
    else if (open.length >= 3) {
      detected = 'research';
    }

    if (detected !== prevMode.current) {
      prevMode.current = detected;
      setMode(detected);
    }
  }, [state.objects, state.activeContext.immersiveObjectId]);

  // Apply CSS vars
  useEffect(() => {
    const vars = MODE_VARS[mode];
    const root = document.documentElement;
    // Smooth transition via CSS
    root.style.transition = 'all 1.5s cubic-bezier(0.4, 0, 0.2, 1)';
    for (const [key, val] of Object.entries(vars)) {
      root.style.setProperty(key, val);
    }
    return () => {
      root.style.transition = '';
    };
  }, [mode]);

  return mode;
}
