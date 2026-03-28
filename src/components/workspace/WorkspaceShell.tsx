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
  useCognitiveMode();
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
    <div className={`workspace-noise relative flex h-screen flex-col overflow-hidden bg-workspace-bg transition-colors duration-1500`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-28 bg-[linear-gradient(to_bottom,rgba(99,102,241,0.07),transparent)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-24 bg-[linear-gradient(to_top,rgba(255,255,255,0.45),transparent)]" />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_15%_15%,rgba(99,102,241,0.07),transparent_24%),radial-gradient(circle_at_85%_10%,rgba(99,102,241,0.05),transparent_20%)]" />
      {/* Cognitive mode passed to SherpaRail via context */}

      {/* Audio mute toggle */}
      <button
        onClick={toggleMute}
        aria-label={muted ? 'Unmute ambient sounds' : 'Mute ambient sounds'}
        className="workspace-pill fixed top-3 right-3 z-50 flex h-11 w-11 items-center justify-center rounded-full text-workspace-text-secondary/35 transition-all duration-200 workspace-spring hover:-translate-y-0.5 hover:text-workspace-text-secondary/75 hover:shadow-[0_14px_30px_rgba(15,23,42,0.08)]"
        title={muted ? 'Unmute sounds' : 'Mute sounds'}
      >
        {muted ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 5L6 9H2v6h4l5 4V5Z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 5L6 9H2v6h4l5 4V5Z" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        )}
      </button>

      {/* Command Palette */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {/* Immersive overlay */}
      <ImmersiveOverlay />

      {/* Main workspace */}
      <div className={`relative z-10 flex flex-1 overflow-hidden transition-opacity duration-500 ${isImmersive ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <PanelCanvas />
        <SherpaRail />
      </div>

      {/* Collapsed bar */}
      {!isImmersive && <CollapsedBar />}

      {/* Over-capacity indicator */}
      {isOverCapacity && !isImmersive && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-40 animate-[materialize_0.4s_cubic-bezier(0.16,1,0.3,1)_forwards]">
          <div className="workspace-pill rounded-full px-4 py-1.5 text-[10px] uppercase tracking-[0.18em] text-workspace-accent backdrop-blur-sm">
            Workspace is busy — inactive objects will recede shortly
          </div>
        </div>
      )}
    </div>
  );
}
