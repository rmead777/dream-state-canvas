import { PanelCanvas } from './PanelCanvas';
import { SherpaRail } from './SherpaRail';
import { CollapsedBar } from './CollapsedBar';
import { ImmersiveOverlay } from './ImmersiveOverlay';
import { useWorkspaceBreathing } from '@/hooks/useWorkspaceBreathing';
import { useWorkspace } from '@/contexts/WorkspaceContext';

/**
 * WorkspaceShell — the root layout.
 * Anti-drift: No sidebar nav. No tab bar. One surface.
 */
export function WorkspaceShell() {
  const { state } = useWorkspace();
  const { isOverCapacity } = useWorkspaceBreathing();
  const isImmersive = !!state.activeContext.immersiveObjectId;

  return (
    <div className="flex h-screen flex-col bg-workspace-bg">
      {/* Immersive overlay — a depth layer, not navigation */}
      <ImmersiveOverlay />

      {/* Main workspace — dims when immersive */}
      <div className={`flex flex-1 overflow-hidden transition-opacity duration-500 ${isImmersive ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        {/* Canvas — where workspace objects materialize */}
        <PanelCanvas />

        {/* Sherpa — intelligence rail, not a chat sidebar */}
        <SherpaRail />
      </div>

      {/* Peripheral zone — collapsed items */}
      {!isImmersive && <CollapsedBar />}

      {/* Over-capacity indicator — subtle breathing signal */}
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
