/**
 * WorkspaceBar — unified bottom bar combining collapsed objects + workspace utilities.
 * Replaces CollapsedBar.tsx and LayoutToggle.tsx.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { useDocumentUpload } from '@/hooks/useDocumentUpload';
import { RulesEditor } from './RulesEditor';
import { DocumentUpload } from './DocumentUpload';
import { MemoryPanel } from './MemoryPanel';
import { WorkspaceRadar } from './WorkspaceRadar';
import { toast } from 'sonner';
import { ActivityTicker } from './ActivityTicker';

type UtilityPanel = 'upload' | 'rules' | 'memory' | 'health' | null;

const TYPE_ICONS: Record<string, string> = {
  metric: '◈', alert: '◆', comparison: '⇄', inspector: '▤',
  brief: '✦', timeline: '◷', document: '▨', dataset: '▥', monitor: '◎',
};

export function WorkspaceBar() {
  const { state, dispatch } = useWorkspace();
  const { restoreObject } = useWorkspaceActions();
  const { handleDocumentIngested } = useDocumentUpload();
  const [activePanel, setActivePanel] = useState<UtilityPanel>(null);
  const [showCanvasMenu, setShowCanvasMenu] = useState(false);
  const canvasMenuRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const isAuto = state.layoutMode === 'auto';

  const collapsed = state.spatialLayout.peripheral
    .map((id) => state.objects[id])
    .filter(Boolean);

  // Close popover/menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setActivePanel(null);
      }
      if (canvasMenuRef.current && !canvasMenuRef.current.contains(e.target as Node)) {
        setShowCanvasMenu(false);
      }
    };
    if (activePanel || showCanvasMenu) {
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }
  }, [activePanel, showCanvasMenu]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActivePanel(null);
        setShowCanvasMenu(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const togglePanel = useCallback((panel: UtilityPanel) => {
    setActivePanel(prev => prev === panel ? null : panel);
    setShowCanvasMenu(false);
  }, []);

  const handleCollapseAll = useCallback(() => {
    dispatch({ type: 'COLLAPSE_ALL_OBJECTS' });
    setShowCanvasMenu(false);
    toast.success('All objects minimized');
  }, [dispatch]);

  const handleDissolveAll = useCallback(() => {
    dispatch({ type: 'DISSOLVE_ALL_OBJECTS' });
    setShowCanvasMenu(false);
    toast.success('Canvas cleared');
  }, [dispatch]);

  const handleToggleLayout = useCallback(() => {
    dispatch({ type: 'SET_LAYOUT_MODE', payload: isAuto ? 'freeform' : 'auto' });
  }, [dispatch, isAuto]);

  return (
    <div className="relative z-30 border-t border-workspace-border/50 bg-white/70 backdrop-blur-md px-4 py-2.5">
      {/* Utility popover (renders above bar) */}
      {activePanel && (
        <div
          ref={popoverRef}
          className="absolute bottom-full right-4 mb-2 z-50 animate-[materialize_0.2s_cubic-bezier(0.16,1,0.3,1)_forwards]"
          style={{
            width: activePanel === 'upload' ? 320 : activePanel === 'rules' ? 360 : 380,
            maxHeight: 400,
          }}
        >
          <div className="workspace-card-surface rounded-2xl border border-workspace-border/45 px-4 py-4 shadow-lg overflow-y-auto" style={{ maxHeight: 400 }}>
            {activePanel === 'upload' && (
              <>
                <span className="text-[9px] uppercase tracking-widest text-workspace-text-secondary/40 block mb-2">
                  Upload Documents
                </span>
                <DocumentUpload onDocumentIngested={handleDocumentIngested} />
                <p className="text-[9px] text-workspace-text-secondary/40 mt-2">
                  XLSX, CSV, PDF, DOCX, TXT, MD, Images
                </p>
              </>
            )}
            {activePanel === 'rules' && (
              <RulesEditor onClose={() => setActivePanel(null)} />
            )}
            {activePanel === 'memory' && (
              <MemoryPanel />
            )}
            {activePanel === 'health' && (
              <WorkspaceRadar />
            )}
          </div>
        </div>
      )}

      {/* Canvas management menu */}
      {showCanvasMenu && (
        <div
          ref={canvasMenuRef}
          className="absolute bottom-full right-28 mb-2 z-50 animate-[materialize_0.2s_cubic-bezier(0.16,1,0.3,1)_forwards]"
        >
          <div className="workspace-card-surface rounded-xl border border-workspace-border/45 py-1 shadow-lg min-w-[160px]">
            <button
              onClick={handleCollapseAll}
              className="w-full px-4 py-2 text-left text-xs text-workspace-text-secondary hover:bg-workspace-surface/50 hover:text-workspace-text transition-colors"
            >
              ↓ Minimize all
            </button>
            <button
              onClick={handleDissolveAll}
              className="w-full px-4 py-2 text-left text-xs text-red-500/70 hover:bg-red-50/50 hover:text-red-600 transition-colors"
            >
              ✕ Clear canvas
            </button>
          </div>
        </div>
      )}

      {/* Bar content */}
      <div className="flex items-center gap-3">
        {/* LEFT ZONE: Collapsed objects */}
        <div className="flex flex-1 items-center gap-2 overflow-x-auto min-w-0">
          {collapsed.length > 0 ? (
            <>
              <span className="flex-shrink-0 text-[9px] font-medium uppercase tracking-[0.2em] text-workspace-text-secondary/50">
                Collapsed
              </span>
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-workspace-accent/10 px-1.5 text-[10px] font-medium text-workspace-accent tabular-nums flex-shrink-0">
                {collapsed.length}
              </span>
              {collapsed.map((obj) => (
                <button
                  key={obj.id}
                  onClick={() => restoreObject(obj.id)}
                  className="flex-shrink-0 rounded-full border border-workspace-border/70 bg-white/85 px-3 py-1.5
                    text-xs text-workspace-text transition-all duration-200
                    hover:-translate-y-0.5 hover:border-workspace-accent/30 hover:shadow-[0_10px_26px_rgba(99,102,241,0.12)]
                    active:translate-y-0 active:scale-[0.985]"
                >
                  <span className="text-workspace-accent mr-1.5 text-[10px]">
                    {TYPE_ICONS[obj.type] || '◇'}
                  </span>
                  {obj.title}
                  {obj.pinned && <span className="ml-1 text-workspace-accent">•</span>}
                </button>
              ))}
            </>
          ) : (
            <ActivityTicker />
          )}
        </div>

        {/* Zone separator */}
        <div className="h-6 w-px bg-workspace-border/40 mx-1 flex-shrink-0" />

        {/* RIGHT ZONE: Workspace utilities */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <UtilityButton
            icon="↑"
            label="Upload"
            active={activePanel === 'upload'}
            onClick={() => togglePanel('upload')}
          />
          <UtilityButton
            icon="⚙"
            label="Rules"
            active={activePanel === 'rules'}
            onClick={() => togglePanel('rules')}
          />
          <UtilityButton
            icon="◈"
            label="Memory"
            active={activePanel === 'memory'}
            onClick={() => togglePanel('memory')}
          />
          <UtilityButton
            icon="♡"
            label="Health"
            active={activePanel === 'health'}
            onClick={() => togglePanel('health')}
          />
          <UtilityButton
            icon="▾"
            label="Canvas"
            active={showCanvasMenu}
            onClick={() => {
              setShowCanvasMenu(prev => !prev);
              setActivePanel(null);
            }}
          />
          <UtilityButton
            icon={isAuto ? '⊞' : '≡'}
            label={isAuto ? 'Freeform' : 'Auto'}
            active={false}
            onClick={handleToggleLayout}
          />
        </div>
      </div>
    </div>
  );
}

function UtilityButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all duration-200
        ${active
          ? 'border-workspace-accent/25 bg-workspace-accent/8 text-workspace-accent shadow-[0_8px_20px_rgba(99,102,241,0.1)]'
          : 'border-workspace-border/50 text-workspace-text-secondary hover:border-workspace-accent/20 hover:text-workspace-accent hover:bg-workspace-accent/5'
        }`}
    >
      <span className={active ? 'text-workspace-accent' : ''}>{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
