/**
 * ActivityTicker — seamless scrolling activity feed.
 *
 * Shows recent workspace events (card creation, uploads, observations)
 * as a horizontal ticker using the duplicated-array animation trick.
 *
 * Pattern from Solar Insight's SystemActivityTicker.
 */
import { useMemo } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { getObjectTypeToken } from '@/lib/design-tokens';

interface TickerItem {
  id: string;
  icon: string;
  text: string;
  time: number;
}

export function ActivityTicker() {
  const { state } = useWorkspace();

  const items = useMemo<TickerItem[]>(() => {
    const events: TickerItem[] = [];

    // Recent object materializations
    const recentObjects = Object.values(state.objects)
      .filter(o => o.status !== 'dissolved')
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 8);

    for (const obj of recentObjects) {
      const token = getObjectTypeToken(obj.type);
      events.push({
        id: `obj-${obj.id}`,
        icon: token.icon,
        text: `${token.label}: ${obj.title}`,
        time: obj.createdAt,
      });
    }

    // Recent intents
    const intents = (state.activeContext.recentIntents || []).slice(-4);
    for (const intent of intents) {
      if (intent.query) {
        events.push({
          id: `intent-${intent.intentId || intent.timestamp}`,
          icon: '→',
          text: intent.query.length > 40 ? intent.query.slice(0, 40) + '…' : intent.query,
          time: intent.timestamp || Date.now(),
        });
      }
    }

    // Recent observations
    for (const obs of (state.sherpa.observations || []).slice(-3)) {
      events.push({
        id: `obs-${obs.slice(0, 20)}`,
        icon: '✦',
        text: obs.length > 50 ? obs.slice(0, 50) + '…' : obs,
        time: Date.now() - 60000,
      });
    }

    return events.sort((a, b) => b.time - a.time).slice(0, 12);
  }, [state.objects, state.activeContext.recentIntents, state.sherpa.observations]);

  if (items.length === 0) return null;

  // Duplicate items for seamless scroll
  const tickerDuration = Math.max(20, items.length * 4);
  const doubled = [...items, ...items];

  return (
    <div
      className="relative overflow-hidden flex-1 min-w-0"
      style={{
        maskImage: 'linear-gradient(to right, transparent, black 6%, black 94%, transparent)',
        WebkitMaskImage: 'linear-gradient(to right, transparent, black 6%, black 94%, transparent)',
      }}
    >
      <div
        className="flex items-center gap-4 whitespace-nowrap animate-ticker-scroll"
        style={{ '--ticker-duration': `${tickerDuration}s` } as React.CSSProperties}
      >
        {doubled.map((item, i) => (
          <span
            key={`${item.id}-${i}`}
            className="inline-flex items-center gap-1.5 text-[10px] text-workspace-text-secondary/60"
          >
            <span className="text-[9px]">{item.icon}</span>
            <span>{item.text}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
