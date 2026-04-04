/**
 * QBOStatusPanel — shows QuickBooks data source connection status
 * in the Context tab of the Sherpa rail.
 *
 * Green = connected (synced within 24h)
 * Yellow = stale (synced > 24h ago)
 * Red = not connected (never synced or error)
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface SourceStatus {
  label: string;
  status: 'connected' | 'stale' | 'not_connected';
  lastSync: string | null;
  recordCount: number;
}

interface QBOStatus {
  connected: boolean;
  company?: string;
  realmId?: string;
  tokenHealthy?: boolean;
  tokenExpiresAt?: string;
  lastSync?: string;
  sources: Record<string, SourceStatus>;
  error?: string;
}

const STATUS_COLORS: Record<string, { dot: string; text: string; bg: string }> = {
  connected: {
    dot: 'bg-emerald-400',
    text: 'text-emerald-400/80',
    bg: 'bg-emerald-400/5',
  },
  stale: {
    dot: 'bg-amber-400',
    text: 'text-amber-400/80',
    bg: 'bg-amber-400/5',
  },
  not_connected: {
    dot: 'bg-red-400',
    text: 'text-red-400/80',
    bg: 'bg-red-400/5',
  },
};

const STATUS_LABELS: Record<string, string> = {
  connected: 'Connected',
  stale: 'Stale',
  not_connected: 'Not Connected',
};

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function QBOStatusPanel() {
  const [status, setStatus] = useState<QBOStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qbo-status`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        },
      );

      if (!response.ok) {
        setStatus({ connected: false, error: 'Status check failed', sources: {} });
        return;
      }

      setStatus(await response.json());
    } catch (err) {
      setStatus({
        connected: false,
        error: err instanceof Error ? err.message : 'Connection failed',
        sources: {},
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    // Re-check every 5 minutes
    const interval = setInterval(fetchStatus, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Overall status: worst of all sources
  const overallStatus = status?.connected
    ? Object.values(status.sources).some(s => s.status === 'not_connected')
      ? 'not_connected'
      : Object.values(status.sources).some(s => s.status === 'stale')
        ? 'stale'
        : 'connected'
    : 'not_connected';

  const overallColors = STATUS_COLORS[overallStatus];

  return (
    <div className="border-b border-workspace-border/30 mb-3">
      {/* Header row */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between py-1.5 text-left group"
      >
        <div className="flex items-center gap-1.5">
          <span
            className="text-[9px] text-workspace-text-secondary/50 transition-transform duration-200"
            style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            ▶
          </span>
          <span className="text-[9px] uppercase tracking-widest text-workspace-text-secondary/40">
            QuickBooks
          </span>
          {loading ? (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-workspace-text-secondary/30 animate-pulse" />
          ) : (
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${overallColors.dot} ${overallStatus === 'connected' ? '' : 'animate-pulse'}`} />
          )}
          {status?.company && (
            <span className="text-[9px] text-workspace-accent/50 truncate max-w-[120px]">
              {status.company}
            </span>
          )}
        </div>
        <span className="text-[8px] text-workspace-text-secondary/30 opacity-0 group-hover:opacity-100 transition-opacity">
          {isExpanded ? 'collapse' : 'expand'}
        </span>
      </button>

      {/* Expanded panel */}
      {isExpanded && (
        <div className="pb-3 animate-[materialize_0.2s_cubic-bezier(0.16,1,0.3,1)_forwards]">
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-2">
              <span className="inline-block h-3 w-3 rounded-full border-2 border-workspace-accent/30 border-t-workspace-accent animate-spin" />
              <span className="text-[10px] text-workspace-text-secondary/50">Checking QuickBooks connection...</span>
            </div>
          ) : !status?.connected ? (
            <div className="px-2 py-2 rounded-md bg-red-400/5 border border-red-400/10">
              <p className="text-[10px] text-red-400/80 font-medium">Not Connected</p>
              <p className="text-[9px] text-workspace-text-secondary/50 mt-0.5">
                {status?.error || 'QuickBooks integration not configured. Set WCW_SUPABASE_URL and related env vars in Supabase edge functions.'}
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {/* Token health */}
              {status.tokenHealthy === false && (
                <div className="px-2 py-1.5 mb-1 rounded-md bg-red-400/5 border border-red-400/10">
                  <p className="text-[9px] text-red-400/70">OAuth token expired — reconnect in Working Capital Wizard</p>
                </div>
              )}

              {/* Source list */}
              {Object.entries(status.sources).map(([key, source]) => {
                const colors = STATUS_COLORS[source.status];
                return (
                  <div
                    key={key}
                    className={`flex items-center gap-2 rounded px-2 py-1.5 ${colors.bg}`}
                  >
                    <span className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${colors.dot}`} />
                    <span className="text-[10px] text-workspace-text flex-1 truncate">
                      {source.label}
                    </span>
                    {source.lastSync ? (
                      <span className={`text-[8px] shrink-0 tabular-nums ${colors.text}`}>
                        {formatRelativeTime(source.lastSync)}
                        {source.recordCount > 0 && (
                          <span className="text-workspace-text-secondary/30 ml-1">
                            ({source.recordCount})
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-[8px] text-red-400/50 shrink-0">
                        {STATUS_LABELS[source.status]}
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Last global sync */}
              {status.lastSync && (
                <p className="text-[8px] text-workspace-text-secondary/30 mt-1.5 px-1">
                  Last sync: {formatRelativeTime(status.lastSync)}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
