import { useWorkspace } from '@/contexts/WorkspaceContext';

export type MobileTab = 'chat' | 'cards' | 'log' | 'context' | 'admin';

export function MobileTabBar({
  activeTab,
  onTabChange,
  adminUnlocked = false,
}: {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  adminUnlocked?: boolean;
}) {
  const { state } = useWorkspace();
  const activeCount = Object.values(state.objects).filter(o => o.status !== 'dissolved').length;

  const tabs: { id: MobileTab; label: string; icon: string; badge?: number }[] = [
    { id: 'chat', label: 'Chat', icon: '✦' },
    { id: 'cards', label: 'Cards', icon: '⊞', badge: activeCount || undefined },
    { id: 'log', label: 'Log', icon: '⊘' },
    { id: 'context', label: 'More', icon: '≡' },
    ...(adminUnlocked ? [{ id: 'admin' as MobileTab, label: 'Admin', icon: '⚙' }] : []),
  ];

  return (
    <div className="relative z-30 flex items-center border-t border-workspace-border/50 bg-white/80 backdrop-blur-xl safe-area-bottom">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 transition-colors ${
            activeTab === tab.id
              ? 'text-workspace-accent'
              : 'text-workspace-text-secondary/50'
          }`}
        >
          <span className="relative text-base">
            {tab.icon}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-workspace-accent px-1 text-[9px] font-semibold text-white tabular-nums">
                {tab.badge}
              </span>
            )}
          </span>
          <span className="text-[10px] font-medium">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
