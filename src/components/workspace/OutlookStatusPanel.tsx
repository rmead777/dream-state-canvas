/**
 * OutlookStatusPanel — shows Outlook email connection status
 * in the Context tab of the Sherpa rail.
 *
 * Shows: signed-in account, active folder, stored email count,
 * last sync time, folder selector, sign-in/sync buttons.
 */

import { useState, useEffect, useCallback } from 'react';
import { isOutlookConnected, getOutlookAccount, signInToOutlook, signOutOfOutlook, syncEmails, getStoredEmailCount, getSyncState } from '@/lib/email-store';

const DEFAULT_FOLDER = 'Incoa AP Automated';

export function OutlookStatusPanel() {
  const [connected, setConnected] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [emailCount, setEmailCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [folderName, setFolderName] = useState(DEFAULT_FOLDER);
  const [editingFolder, setEditingFolder] = useState(false);
  const [folderInput, setFolderInput] = useState(DEFAULT_FOLDER);
  const [syncDays, setSyncDays] = useState(90);

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

  // Once connected, load stored email count from Supabase
  useEffect(() => {
    if (connected && emailCount === null) {
      getStoredEmailCount(folderName).then(count => setEmailCount(count)).catch(() => {});
      getSyncState(folderName).then(state => {
        if (state?.last_sync_at) setLastSync(state.last_sync_at);
      }).catch(() => {});
    }
  }, [connected, emailCount, folderName]);

  const handleSignIn = async () => {
    setLoading(true);
    await signInToOutlook();
    setLoading(false);
  };

  const handleSync = async () => {
    setLoading(true);
    try {
      // On first sync (no lastSync), use syncDays as the lookback window
      const isFirstSync = !lastSync;
      const result = await syncEmails(folderName, {
        daysBack: isFirstSync ? syncDays : undefined,
      });
      setEmailCount(result.totalStored);
      setLastSync(new Date().toISOString());
    } catch {}
    setLoading(false);
  };

  const handleFolderChange = () => {
    const trimmed = folderInput.trim();
    if (trimmed && trimmed !== folderName) {
      setFolderName(trimmed);
      setEmailCount(null);
      setLastSync(null);
    }
    setEditingFolder(false);
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
            <div className="space-y-1">
              {/* Account */}
              <div className="flex items-center gap-2 rounded px-2 py-1 bg-emerald-400/5">
                <span className="inline-block h-1.5 w-1.5 rounded-full shrink-0 bg-emerald-400" />
                <span className="text-[10px] text-workspace-text flex-1 truncate">
                  {accountName}
                </span>
                <span className="text-[8px] text-emerald-400/60 shrink-0">
                  Connected
                </span>
              </div>

              {/* Folder — click to edit */}
              <div className="flex items-center gap-2 rounded px-2 py-1 bg-workspace-surface/30">
                <span className="text-[9px] text-workspace-text-secondary/40 shrink-0">Folder:</span>
                {editingFolder ? (
                  <input
                    type="text"
                    value={folderInput}
                    onChange={e => setFolderInput(e.target.value)}
                    onBlur={handleFolderChange}
                    onKeyDown={e => { if (e.key === 'Enter') handleFolderChange(); if (e.key === 'Escape') { setFolderInput(folderName); setEditingFolder(false); } }}
                    autoFocus
                    className="flex-1 bg-transparent text-[10px] text-workspace-text border-b border-workspace-accent/30 outline-none px-0 py-0"
                  />
                ) : (
                  <button
                    onClick={() => { setFolderInput(folderName); setEditingFolder(true); }}
                    className="flex-1 text-left text-[10px] text-workspace-text truncate hover:text-workspace-accent transition-colors"
                    title="Click to change folder"
                  >
                    {folderName}
                  </button>
                )}
                <span className="text-[8px] text-workspace-text-secondary/40 shrink-0 tabular-nums">
                  {emailCount != null ? `${emailCount}` : '—'}
                </span>
              </div>

              {/* Date range — only on first sync */}
              {!lastSync && (
                <div className="flex items-center gap-2 rounded px-2 py-1 bg-workspace-surface/30">
                  <span className="text-[9px] text-workspace-text-secondary/40 shrink-0">Lookback:</span>
                  <select
                    value={syncDays}
                    onChange={e => setSyncDays(Number(e.target.value))}
                    className="flex-1 bg-transparent text-[10px] text-workspace-text outline-none cursor-pointer"
                  >
                    <option value={30}>Last 30 days</option>
                    <option value={60}>Last 60 days</option>
                    <option value={90}>Last 90 days</option>
                    <option value={180}>Last 6 months</option>
                    <option value={365}>Last year</option>
                    <option value={0}>All time</option>
                  </select>
                </div>
              )}

              {/* Sync button */}
              <button
                onClick={handleSync}
                disabled={loading}
                className="w-full mt-1 rounded px-2 py-1 text-[9px] text-workspace-text-secondary/50 hover:text-workspace-accent border border-workspace-border/20 hover:border-workspace-accent/20 transition-colors disabled:opacity-50"
              >
                {loading ? 'Syncing...' : lastSync ? 'Sync New Emails' : 'Initial Sync'}
              </button>

              <p className="text-[8px] text-workspace-text-secondary/30 mt-0.5 px-1">
                {lastSync
                  ? `Last sync: ${new Date(lastSync).toLocaleString()}`
                  : 'First sync pulls emails from the selected time range.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
