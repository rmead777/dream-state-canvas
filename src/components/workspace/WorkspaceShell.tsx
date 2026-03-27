import { PanelCanvas } from './PanelCanvas';
import { SherpaRail } from './SherpaRail';
import { CollapsedBar } from './CollapsedBar';

/**
 * WorkspaceShell — the root layout.
 * Anti-drift: No sidebar nav. No tab bar. One surface.
 */
export function WorkspaceShell() {
  return (
    <div className="flex h-screen flex-col bg-workspace-bg">
      {/* Main workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas — where workspace objects materialize */}
        <PanelCanvas />

        {/* Sherpa — intelligence rail, not a chat sidebar */}
        <SherpaRail />
      </div>

      {/* Peripheral zone — collapsed items */}
      <CollapsedBar />
    </div>
  );
}
