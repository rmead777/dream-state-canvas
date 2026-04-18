/**
 * QBOStatusPanel — shows QuickBooks data source connection status
 * in the Context tab of the Sherpa rail.
 *
 * DSC fetches live from QuickBooks API every time — data is always fresh.
 * This panel probes QB directly to show whether each source is reachable.
 *
 * Green = connected (QB API responds, data available)
 * Red = not connected (QB API error, token expired, or not configured)
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { clearQBOCache, warmQBOCache, getQBOFetchedAt } from '@/lib/quickbooks-store';

interface SourceStatus {
  label: string;
  status: 'connected' | 'not_connected';
  recordCount?: number;
  error?: string;
}

interface QBOStatus {
  connected: boolean;
  company?: string;
  realmId?: string;
  tokenHealthy?: boolean;
  sources: Record<string, SourceStatus>;
  error?: string;
}

const STATUS_COLORS = {
  connected: {
    dot: 'bg-emerald-400',
    text: 'text-emerald-400/80',
    bg: 'bg-emerald-400/5',
  },
  not_connected: {
    dot: 'bg-red-400',
    text: 'text-red-400/80',
    bg: 'bg-red-400/5',
  },
};

export function QBOStatusPanel() {
  const [status, setStatus] = useState<QBOStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      // Use GET to avoid CORS preflight issues with Content-Type header
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qbo-status`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        },
      );

      if (!response.ok) {
        // Don't treat as hard error — just show not configured
        setStatus({ connected: false, sources: {} });
        return;
      }

      setStatus(await response.json());
    } catch {
      // Silently show not configured — don't spam console
      setStatus({ connected: false, sources: {} });
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Force a QuickBooks token refresh — mirrors WCW's "Sync" button.
   * Calls qbo-refresh (which hits Intuit's refresh endpoint unconditionally),
   * clears DSC's data cache, and re-fetches status so the panel updates.
   */
  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qbo-refresh`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
      const result = await resp.json();
      if (!resp.ok) {
        setSyncError(result.error || `Sync failed (HTTP ${resp.status})`);
        return;
      }
      clearQBOCache();
      await fetchStatus();
      warmQBOCache();
    } catch (err) {
      setSyncError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }, [fetchStatus]);

  // Track whether we've already triggered the warm fetch this session
  const [warmed, setWarmed] = useState(false);

  useEffect(() => {
    fetchStatus();
    // Re-check every 5 minutes to keep the QB token alive
    // (QB tokens expire after 1 hour; the edge function auto-refreshes
    //  when within 5 minutes of expiry, so checking every 5 min ensures
    //  we always trigger refresh before expiry)
    const interval = setInterval(fetchStatus, 5 * 60 * 1000);

    // Browser throttles/suspends timers in background tabs.
    // When the user returns to the tab, re-check immediately so the
    // token refresh fires even if setInterval was suspended.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchStatus();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchStatus]);

  // Warm fetch: once we confirm QB is connected, pre-load the summary
  // so Sherpa has instant access on the user's first question
  useEffect(() => {
    if (status?.connected && !warmed) {
      setWarmed(true);
      warmQBOCache();
    }
  }, [status?.connected, warmed]);

  const connectedCount = status
    ? Object.values(status.sources).filter(s => s.status === 'connected').length
    : 0;
  const totalCount = status ? Object.keys(status.sources).length : 0;
  const allConnected = connectedCount === totalCount && totalCount > 0;
  const notConfigured = !status?.connected && totalCount === 0;

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
          ) : notConfigured ? (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-workspace-text-secondary/30" />
          ) : (
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${allConnected ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
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
              <span className="text-[10px] text-workspace-text-secondary/50">Checking QuickBooks...</span>
            </div>
          ) : !status?.connected ? (
            <div className="space-y-1.5">
              <div className="px-2 py-1.5 rounded-md bg-workspace-surface/30 border border-workspace-border/20">
                <p className="text-[10px] text-workspace-text-secondary/60">Not connected</p>
                {status?.error ? (
                  <p className="text-[8px] text-workspace-text-secondary/40 mt-1 break-words leading-relaxed">
                    {status.error}
                  </p>
                ) : (
                  <p className="text-[8px] text-workspace-text-secondary/30 mt-0.5">
                    Click Sync to refresh the QuickBooks token.
                  </p>
                )}
              </div>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="w-full rounded px-2 py-1.5 text-[10px] text-workspace-accent border border-workspace-accent/30 hover:bg-workspace-accent/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {syncing ? 'Syncing…' : 'Sync QuickBooks'}
              </button>
              {syncError && (
                <p className="text-[9px] text-red-400/70 px-1 break-words leading-relaxed">
                  {syncError}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-0.5">
              {/* Token health warning */}
              {status.tokenHealthy === false && (
                <div className="px-2 py-1.5 mb-1 rounded-md bg-red-400/5 border border-red-400/10">
                  <p className="text-[9px] text-red-400/70">OAuth token expired — attempting auto-refresh...</p>
                  <button
                    onClick={() => { setLoading(true); fetchStatus(); }}
                    className="text-[9px] text-red-400/70 underline hover:text-red-500 mt-0.5"
                  >
                    Retry now
                  </button>
                </div>
              )}
              {status.error && (
                <div className="px-2 py-1.5 mb-1 rounded-md bg-amber-400/5 border border-amber-400/10">
                  <p className="text-[9px] text-amber-600/70">{status.error}</p>
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
                    {source.status === 'connected' ? (
                      <span className="text-[8px] text-emerald-400/60 shrink-0 tabular-nums">
                        Live
                        {source.recordCount != null && source.recordCount > 0 && (
                          <span className="text-workspace-text-secondary/30 ml-1">
                            ({source.recordCount})
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-[8px] text-red-400/50 shrink-0">
                        Error
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Sync button — force-refresh OAuth token + clear data cache (mirrors WCW's Sync) */}
              <button
                onClick={handleSync}
                disabled={syncing}
                className="w-full mt-2 rounded px-2 py-1 text-[9px] text-workspace-text-secondary/50 hover:text-workspace-accent border border-workspace-border/20 hover:border-workspace-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {syncing ? 'Syncing…' : 'Sync QuickBooks'}
              </button>
              {syncError && (
                <p className="text-[9px] text-red-400/70 px-1 mt-1 break-words leading-relaxed">
                  {syncError}
                </p>
              )}

              <p className="text-[8px] text-workspace-text-secondary/30 mt-1 px-1">
                Sync refreshes the token + reloads data. Auto-refreshes every 5 min.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
