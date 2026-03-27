import { WorkspaceObject } from '@/lib/workspace-types';

const severityStyles = {
  high: 'border-l-red-500 bg-red-50/50',
  medium: 'border-l-amber-500 bg-amber-50/30',
  low: 'border-l-slate-400 bg-workspace-surface/30',
};

const severityBadge = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-slate-100 text-slate-600',
};

export function AlertRiskPanel({ object }: { object: WorkspaceObject }) {
  const alerts = object.context?.alerts || [];

  return (
    <div className="space-y-3">
      {alerts.map((alert: any) => (
        <div
          key={alert.id}
          className={`rounded-lg border-l-2 px-4 py-3 transition-colors ${severityStyles[alert.severity as keyof typeof severityStyles] || severityStyles.low}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${severityBadge[alert.severity as keyof typeof severityBadge] || severityBadge.low}`}
                >
                  {alert.severity}
                </span>
                <h4 className="text-sm font-medium text-workspace-text">{alert.title}</h4>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-workspace-text-secondary">
                {alert.description}
              </p>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3 text-[10px] text-workspace-text-secondary">
            <span>{formatTimeAgo(alert.timestamp)}</span>
            {alert.actionable && (
              <span className="rounded-full bg-workspace-accent-subtle px-2 py-0.5 text-workspace-accent">
                Actionable
              </span>
            )}
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
