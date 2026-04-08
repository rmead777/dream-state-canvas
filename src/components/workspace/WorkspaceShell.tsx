import { useState, useEffect, useRef } from 'react';
import { PanelCanvas } from './PanelCanvas';
import { SherpaRail } from './SherpaRail';
import { WorkspaceBar } from './WorkspaceBar';
import { ImmersiveOverlay } from './ImmersiveOverlay';
import { CommandPalette } from './CommandPalette';
import { MobileShell } from './MobileShell';
import { BackgroundShader } from './BackgroundShader';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useWorkspaceBreathing } from '@/hooks/useWorkspaceBreathing';
import { useCognitiveMode } from '@/hooks/useCognitiveMode';
import { useAmbientAudio } from '@/hooks/useAmbientAudio';
import { useWorkspacePersistence } from '@/hooks/useWorkspacePersistence';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/hooks/useAuth';

export function WorkspaceShell() {
  const { state } = useWorkspace();
  const { user, signOut } = useAuth();
  const { isMobile } = useIsMobile();
  const { isOverCapacity } = useWorkspaceBreathing();
  useCognitiveMode();
  const { play, muted, toggleMute } = useAmbientAudio();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const isImmersive = !!state.activeContext.immersiveObjectId;

  // Close profile dropdown on outside click
  useEffect(() => {
    if (!profileOpen) return;
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [profileOpen]);

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

  // Mobile layout — completely different component tree
  if (isMobile) {
    return <MobileShell />;
  }

  return (
    <div className={`relative flex h-screen flex-col overflow-hidden transition-colors duration-1500`}>
      <BackgroundShader />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-28 bg-[linear-gradient(to_bottom,rgba(99,102,241,0.07),transparent)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-24 bg-[linear-gradient(to_top,rgba(255,255,255,0.45),transparent)]" />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_15%_15%,rgba(99,102,241,0.07),transparent_24%),radial-gradient(circle_at_85%_10%,rgba(99,102,241,0.05),transparent_20%)]" />
      {/* Cognitive mode passed to SherpaRail via context */}

      {/* User profile pill */}
      {user && (
        <div ref={profileRef} className="fixed top-3 right-16 z-50">
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="workspace-pill flex items-center gap-2 rounded-full px-2.5 py-1.5 text-workspace-text-secondary/60 transition-all duration-200 workspace-spring hover:-translate-y-0.5 hover:text-workspace-text-secondary hover:shadow-[0_14px_30px_rgba(15,23,42,0.08)]"
            title={user.email || 'Account'}
          >
            {user.user_metadata?.avatar_url ? (
              <img src={user.user_metadata.avatar_url} alt="" className="h-6 w-6 rounded-full" />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-workspace-accent/15 text-[10px] font-semibold text-workspace-accent">
                {(user.user_metadata?.full_name || user.email || '?').charAt(0).toUpperCase()}
              </div>
            )}
            <span className="text-[11px] font-medium max-w-[120px] truncate hidden sm:inline">
              {user.user_metadata?.full_name || user.email?.split('@')[0] || 'Account'}
            </span>
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl border border-workspace-border/40 bg-white/95 backdrop-blur-sm shadow-[0_8px_30px_rgba(0,0,0,0.08)] overflow-hidden">
              <div className="px-3.5 py-3 border-b border-workspace-border/20">
                <p className="text-[12px] font-medium text-workspace-text truncate">
                  {user.user_metadata?.full_name || 'User'}
                </p>
                <p className="text-[10px] text-workspace-text-secondary/60 truncate">
                  {user.email}
                </p>
              </div>
              <button
                onClick={() => { setProfileOpen(false); signOut(); }}
                className="w-full px-3.5 py-2.5 text-left text-[11px] text-workspace-text-secondary hover:bg-workspace-surface/30 hover:text-workspace-text transition-colors"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      )}

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

      {/* Workspace bar (collapsed objects + utilities) */}
      {!isImmersive && <WorkspaceBar />}

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
