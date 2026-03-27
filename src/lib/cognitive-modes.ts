// Cognitive mode detection — pure logic, no React dependency
import { WorkspaceObject } from './workspace-types';

export type CognitiveMode = 'neutral' | 'research' | 'analysis' | 'decision' | 'synthesis';

export function detectCognitiveMode(
  objects: Record<string, WorkspaceObject>,
  immersiveId: string | null
): CognitiveMode {
  const active = Object.values(objects).filter(
    (o) => o.status === 'open' || o.status === 'materializing'
  );

  if (immersiveId) return 'analysis';
  if (active.some((o) => o.type === 'alert') && active.some((o) => o.type === 'comparison' || o.type === 'metric')) return 'decision';
  if (active.some((o) => o.type === 'brief')) return 'synthesis';
  if (active.length >= 3) return 'research';
  return 'neutral';
}

export const MODE_LABELS: Record<CognitiveMode, string> = {
  neutral: '',
  research: 'Research',
  analysis: 'Deep Focus',
  decision: 'Decision',
  synthesis: 'Synthesis',
};
