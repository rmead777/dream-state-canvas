import { useState, useEffect } from 'react';
import { PanelCanvas } from './PanelCanvas';
import { SherpaRail } from './SherpaRail';
import { CollapsedBar } from './CollapsedBar';
import { ImmersiveOverlay } from './ImmersiveOverlay';
import { CommandPalette } from './CommandPalette';
import { useWorkspaceBreathing } from '@/hooks/useWorkspaceBreathing';
import { useCognitiveMode } from '@/hooks/useCognitiveMode';
import { useAmbientAudio } from '@/hooks/useAmbientAudio';
import { useWorkspacePersistence } from '@/hooks/useWorkspacePersistence';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export function WorkspaceShell() {
  const { state } = useWorkspace();
  const { isOverCapacity } = useWorkspaceBreathing();
  const cognitiveMode = useCognitiveMode();
  const { play, muted, toggleMute } = useAmbientAudio();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const isImmersive = !!state.activeContext.immersiveObjectId;

  // Persistence
  useWorkspacePersistence();

  // Cmd+K handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Sound on immersive transitions
  useEffect(() => {
    if (isImmersive) play('immersive-enter');
  }, [isImmersive]);

  return (
    <div className={`flex h-screen flex-col bg-workspace-bg transition-colors duration-1500`}>
      {/* Cognitive mode indicator */}
      {cognitiveMode !== 'neutral' && !isImmersive && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-40 animate-[materialize_0.4s_cubic-bezier(0.16,1,0.3,1)_forwards]">
          <div className="rounded-full bg-workspace-accent/6 border border-workspace-accent/10 px-3.5 py-1 text-[9px] uppercase tracking-widest text-workspace-accent/60 backdrop-blur-sm">
            {MODE_LABELS[cognitiveMode]}
          </div>
        </div>
      )}

      {/* Audio mute toggle */}
      <button
        onClick={toggleMute}
        className="fixed top-3 right-3 z-50 rounded-full p-2 text-workspace-text-secondary/30 hover:text-workspace-text-secondary/60 transition-colors"
        title={muted ? 'Unmute sounds' : 'Mute sounds'}
      >
        {muted ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 5L6 9H2v6h4l5 4V5Z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 5L6 9H2v6h4l5 4V5Z" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        )}
      </button>

      {/* Command Palette */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {/* Immersive overlay */}
      <ImmersiveOverlay />

      {/* Main workspace */}
      <div className={`flex flex-1 overflow-hidden transition-opacity duration-500 ${isImmersive ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <PanelCanvas />
        <SherpaRail />
      </div>

      {/* Collapsed bar */}
      {!isImmersive && <CollapsedBar />}

      {/* Over-capacity indicator */}
      {isOverCapacity && !isImmersive && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-40 animate-[materialize_0.4s_cubic-bezier(0.16,1,0.3,1)_forwards]">
          <div className="rounded-full bg-workspace-accent/8 border border-workspace-accent/15 px-4 py-1.5 text-[10px] text-workspace-accent backdrop-blur-sm">
            Workspace is busy — inactive objects will recede shortly
          </div>
        </div>
      )}
    </div>
  );
}
