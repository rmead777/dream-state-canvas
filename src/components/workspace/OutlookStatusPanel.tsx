/**
 * OutlookStatusPanel — shows Outlook email connection status
 * in the Context tab of the Sherpa rail.
 *
 * Green = signed in (MSAL has active account)
 * Gray = not signed in (sign-in button available)
 */

import { useState, useEffect, useCallback } from 'react';
import { isOutlookConnected, getOutlookAccount, signInToOutlook, signOutOfOutlook, syncEmails, getStoredEmailCount, getSyncState } from '@/lib/email-store';

export function OutlookStatusPanel() {
  const [connected, setConnected] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [emailCount, setEmailCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  const checkConnection = useCallback(() => {
    const conn = isOutlookConnected();
    setConnected(conn);
    if (conn) {
      const account = getOutlookAccount();
      setAccountName(account?.username || account?.name || null);
    } else {
      setAccountName(null);
      setEmailCount(null);
    }
  }, []);

  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, [checkConnection]);

  const [lastSync, setLastSync] = useState<string | null>(null);

  // Once connected, load stored email count from Supabase
  useEffect(() => {
    if (connected && emailCount === null) {
      getStoredEmailCount().then(count => setEmailCount(count)).catch(() => {});
      getSyncState().then(state => {
        if (state?.last_sync_at) setLastSync(state.last_sync_at);
      }).catch(() => {});
    }
  }, [connected, emailCount]);

  const handleSignIn = async () => {
    setLoading(true);
    const success = await signInToOutlook();
    if (success) {
      checkConnection();
    }
    setLoading(false);
  };

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const result = await syncEmails();
      setEmailCount(result.totalStored);
      setLastSync(new Date().toISOString());
    } catch {}
    setLoading(false);
  };

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
            Outlook
          </span>
          {connected ? (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
          ) : (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-workspace-text-secondary/30" />
          )}
          {accountName && (
            <span className="text-[9px] text-workspace-accent/50 truncate max-w-[120px]">
              {accountName}
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
          {!connected ? (
            <div className="space-y-2">
              <div className="px-2 py-1.5 rounded-md bg-workspace-surface/30 border border-workspace-border/20">
                <p className="text-[10px] text-workspace-text-secondary/60">Not signed in</p>
                <p className="text-[8px] text-workspace-text-secondary/30 mt-0.5">
                  Sign in to access AP emails from Outlook.
                </p>
              </div>
              <button
                onClick={handleSignIn}
                disabled={loading}
                className="w-full rounded px-2 py-1.5 text-[10px] font-medium text-workspace-accent border border-workspace-accent/20 bg-workspace-accent/5 hover:bg-workspace-accent/10 transition-colors disabled:opacity-50"
              >
                {loading ? 'Signing in...' : 'Sign In to Outlook'}
              </button>
            </div>
          ) : (
            <div className="space-y-0.5">
              {/* Connection info */}
              <div className="flex items-center gap-2 rounded px-2 py-1.5 bg-emerald-400/5">
                <span className="inline-block h-1.5 w-1.5 rounded-full shrink-0 bg-emerald-400" />
                <span className="text-[10px] text-workspace-text flex-1 truncate">
                  Incoa AP Automated
                </span>
                <span className="text-[8px] text-emerald-400/60 shrink-0 tabular-nums">
                  {emailCount != null ? `${emailCount} stored` : 'Connected'}
                </span>
              </div>

              {/* Sync button */}
              <button
                onClick={handleRefresh}
                disabled={loading}
                className="w-full mt-2 rounded px-2 py-1 text-[9px] text-workspace-text-secondary/50 hover:text-workspace-accent border border-workspace-border/20 hover:border-workspace-accent/20 transition-colors disabled:opacity-50"
              >
                {loading ? 'Syncing...' : 'Sync New Emails'}
              </button>

              <p className="text-[8px] text-workspace-text-secondary/30 mt-1 px-1">
                {lastSync
                  ? `Last sync: ${new Date(lastSync).toLocaleString()}`
                  : 'Emails stored in Supabase. Click sync to pull new ones.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
