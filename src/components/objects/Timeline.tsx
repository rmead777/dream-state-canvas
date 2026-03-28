import { WorkspaceObject } from '@/lib/workspace-types';

const typeIcons = {
  system: '◆',
  user: '◇',
  ai: '✦',
};

const typeColors = {
  system: 'text-amber-600',
  user: 'text-workspace-text',
  ai: 'text-workspace-accent',
};

export function Timeline({ object }: { object: WorkspaceObject }) {
  const events = object.context?.events || [];

  return (
    <div className="relative space-y-0">
      {/* Vertical line */}
      <div className="absolute left-[7px] top-2 bottom-2 w-px bg-workspace-border" />

      {events.map((event: any, _i: number) => (
        <div key={event.id} className="relative flex gap-3 py-2.5">
          {/* Dot */}
          <div
            className={`relative z-10 mt-1.5 h-[15px] w-[15px] flex-shrink-0 flex items-center justify-center text-[8px] ${typeColors[event.type as keyof typeof typeColors] || typeColors.system}`}
          >
            {typeIcons[event.type as keyof typeof typeIcons] || '◆'}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm text-workspace-text leading-snug">{event.content}</p>
            <span className="text-[10px] text-workspace-text-secondary mt-0.5 block">
              {formatTimeAgo(event.timestamp)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
