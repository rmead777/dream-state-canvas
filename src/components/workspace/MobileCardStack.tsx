import { useState, useRef, useCallback } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { getObjectTypeToken, getFamilyTokens } from '@/lib/design-tokens';
import { WorkspaceObject as WO } from '@/lib/workspace-types';

const SWIPE_THRESHOLD = 60;
const SWIPE_MAX_Y = 40;

function CompactCard({ object }: { object: WO }) {
  const { collapseObject, dissolveObject } = useWorkspaceActions();
  const { dispatch } = useWorkspace();
  const typeToken = getObjectTypeToken(object.type);
  const familyToken = getFamilyTokens(object.type);
  const [swipeX, setSwipeX] = useState(0);
  const touchRef = useRef<{ startX: number; startY: number } | null>(null);

  const summary = object.context?.content
    ? object.context.content.slice(0, 100).replace(/[#*_\n]/g, ' ').trim()
    : object.context?.sections?.[0]?.content?.slice(0, 100)?.replace(/[#*_\n]/g, ' ').trim()
    || '';

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchRef.current = { startX: touch.clientX, startY: touch.clientY };
    setSwipeX(0);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchRef.current.startX;
    const dy = Math.abs(touch.clientY - touchRef.current.startY);
    if (dy > SWIPE_MAX_Y) {
      touchRef.current = null;
      setSwipeX(0);
      return;
    }
    setSwipeX(dx);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (swipeX < -SWIPE_THRESHOLD) {
      collapseObject(object.id);
    } else if (swipeX > SWIPE_THRESHOLD) {
      dispatch({ type: 'ENTER_IMMERSIVE', payload: { id: object.id } });
    }
    setSwipeX(0);
    touchRef.current = null;
  }, [swipeX, object.id, collapseObject, dispatch]);

  const swipeStyle = swipeX !== 0 ? {
    transform: `translateX(${swipeX * 0.5}px)`,
    opacity: 1 - Math.abs(swipeX) / 300,
  } : {};

  return (
    <div
      className="group relative flex items-center gap-3 rounded-xl border border-workspace-border/50 bg-white/90 px-4 py-3 shadow-sm transition-all duration-200 active:scale-[0.98]"
      style={swipeStyle}
      onClick={() => dispatch({ type: 'ENTER_IMMERSIVE', payload: { id: object.id } })}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Type icon */}
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${familyToken.pillBg} ${familyToken.pillText} text-sm`}>
        {typeToken.icon || '◇'}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {typeToken.label && (
            <span className={`rounded-full ${familyToken.pillBg} ${familyToken.pillText} px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.15em]`}>
              {typeToken.label}
            </span>
          )}
          {object.pinned && <span className="text-workspace-accent text-[10px]">Pinned</span>}
        </div>
        <h3 className="text-sm font-medium text-workspace-text truncate mt-0.5">{object.title}</h3>
        {summary && (
          <p className="text-[11px] text-workspace-text-secondary/60 truncate mt-0.5">{summary}</p>
        )}
      </div>

      {/* Quick actions — always visible on mobile */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); collapseObject(object.id); }}
          className="flex h-11 w-11 items-center justify-center rounded-full text-workspace-text-secondary/40 hover:bg-workspace-surface/60 hover:text-workspace-text-secondary transition-colors"
          title="Collapse"
        >
          ↓
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); dissolveObject(object.id); }}
          className="flex h-11 w-11 items-center justify-center rounded-full text-workspace-text-secondary/40 hover:bg-red-50 hover:text-red-500 transition-colors"
          title="Dissolve"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export function MobileCardStack() {
  const { state } = useWorkspace();
  const { restoreObject } = useWorkspaceActions();
  const { spatialLayout, objects } = state;

  const activeObjects = [...spatialLayout.primary, ...spatialLayout.secondary]
    .map(id => objects[id])
    .filter(o => o && o.status !== 'dissolved');

  const collapsed = spatialLayout.peripheral
    .map(id => objects[id])
    .filter(Boolean);

  if (activeObjects.length === 0 && collapsed.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-workspace-accent/12 bg-white/75 text-xl text-workspace-accent">
            ⊞
          </div>
          <p className="text-sm text-workspace-text/80">No cards yet</p>
          <p className="mt-1 text-[11px] text-workspace-text-secondary/50">
            Ask Sherpa to create something — cards will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
      {activeObjects.length > 0 && (
        <div className="space-y-2">
          <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-workspace-text-secondary/50 px-1">
            Active · {activeObjects.length}
          </span>
          {activeObjects.map(obj => (
            <CompactCard key={obj.id} object={obj} />
          ))}
        </div>
      )}

      {collapsed.length > 0 && (
        <div className="space-y-2 pt-2">
          <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-workspace-text-secondary/50 px-1">
            Collapsed · {collapsed.length}
          </span>
          {collapsed.map(obj => (
            <button
              key={obj.id}
              onClick={() => restoreObject(obj.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-workspace-border/40 bg-white/60 px-4 py-2.5 text-left transition-all active:scale-[0.98]"
            >
              <span className="text-workspace-text-secondary/40 text-sm">
                {getObjectTypeToken(obj.type).icon || '◇'}
              </span>
              <span className="text-xs text-workspace-text-secondary truncate">{obj.title}</span>
              <span className="ml-auto text-[10px] text-workspace-accent">Restore</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
