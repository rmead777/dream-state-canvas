/**
 * AITelemetryPanel — displays AI model call log with billing info.
 * Shows model, duration, billing type (subscription/api-key/gateway), and fallback status.
 */
import { useState, useEffect } from 'react';
import { getAITelemetryEvents, type AICallEvent } from '@/lib/ai-telemetry';

const BILLING_LABELS: Record<string, { label: string; color: string }> = {
  subscription: { label: 'subscription', color: 'text-emerald-500' },
  'api-key': { label: 'api-key', color: 'text-amber-500' },
  gateway: { label: 'gateway', color: 'text-blue-500' },
  unknown: { label: 'unknown', color: 'text-workspace-text-secondary/50' },
};

export function AITelemetryPanel() {
  const [events, setEvents] = useState<AICallEvent[]>(getAITelemetryEvents());

  useEffect(() => {
    const handler = () => setEvents([...getAITelemetryEvents()]);
    window.addEventListener('ai-telemetry', handler);
    window.addEventListener('ai-telemetry-clear', handler);
    return () => {
      window.removeEventListener('ai-telemetry', handler);
      window.removeEventListener('ai-telemetry-clear', handler);
    };
  }, []);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <span className="text-workspace-text-secondary/40 text-sm">No AI calls yet</span>
        <span className="text-workspace-text-secondary/30 text-xs mt-1">Events appear as you interact with Sherpa</span>
      </div>
    );
  }

  return (
    <div className="space-y-1 font-mono text-[11px]">
      {events.map((event) => {
        const billing = BILLING_LABELS[event.billing] || BILLING_LABELS.unknown;
        const time = new Date(event.timestamp).toLocaleTimeString('en-US', { hour12: false });
        const modelShort = event.model.split('/').pop() || event.model;

        return (
          <div
            key={event.id}
            className="flex items-baseline gap-2 rounded-md px-2 py-1.5 hover:bg-workspace-surface/40 transition-colors"
          >
            <span className="text-workspace-text-secondary/40 shrink-0 tabular-nums">{time}</span>
            <span className="text-workspace-text font-medium truncate">{modelShort}</span>
            <span className={`shrink-0 ${billing.color}`}>{billing.label}</span>
            <span className="text-workspace-text-secondary/50 tabular-nums shrink-0">
              {(event.durationMs / 1000).toFixed(1)}s
            </span>
            {event.fallback && (
              <span className="text-amber-500 text-[9px] shrink-0">fallback</span>
            )}
            {event.toolCalls !== undefined && event.toolCalls > 0 && (
              <span className="text-workspace-accent/60 text-[9px] shrink-0">tools</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
