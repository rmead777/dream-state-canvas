/**
 * OutlookStatusPanel — shows Outlook email connection status
 * in the Context tab of the Sherpa rail.
 *
 * Shows: signed-in account, active folder, stored email count,
 * last sync time, folder selector, sign-in/sync buttons.
 */

import { useState, useEffect, useCallback } from 'react';
import { isOutlookConnected, getOutlookAccount, signInToOutlook, signOutOfOutlook, syncEmails, getStoredEmailCount, getSyncState, listMailFolders } from '@/lib/email-store';

const DEFAULT_FOLDER = 'Incoa AP Automated';

export function OutlookStatusPanel() {
  const [connected, setConnected] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [emailCount, setEmailCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [folderName, setFolderName] = useState(DEFAULT_FOLDER);
  const [editingFolder, setEditingFolder] = useState(false);
  const [folderInput, setFolderInput] = useState(DEFAULT_FOLDER);
  const [syncDays, setSyncDays] = useState(90);
  const [browsing, setBrowsing] = useState(false);
  const [folders, setFolders] = useState<Array<{ id: string; displayName: string; totalItemCount: number }> | null>(null);

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
    setSyncError(null);
    try {
      // On first sync (no lastSync), use syncDays as the lookback window
      const isFirstSync = !lastSync;
      const result = await syncEmails(folderName, {
        daysBack: isFirstSync ? syncDays : undefined,
      });
      setEmailCount(result.totalStored);
      setLastSync(new Date().toISOString());
    } catch (e: any) {
      const msg = e?.message || 'Sync failed';
      setSyncError(msg);
      console.error('[OutlookStatusPanel] Sync error:', e);
    }
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

  const handleBrowseFolders = async () => {
    setBrowsing(true);
    try {
      const result = await listMailFolders();
      setFolders(result);
    } catch {
      setFolders([]);
    }
    setBrowsing(false);
  };

  const handleSelectFolder = (name: string) => {
    // For child folders shown as "Parent / Child", use just the child name for the Graph API filter
    const actualName = name.includes(' / ') ? name.split(' / ').pop()! : name;
    setFolderName(actualName);
    setFolderInput(actualName);
    setEmailCount(null);
    setLastSync(null);
    setFolders(null);
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

              {/* Browse folders button + folder list */}
              <button
                onClick={handleBrowseFolders}
                disabled={browsing}
                className="w-full rounded px-2 py-1 text-[9px] text-workspace-text-secondary/40 hover:text-workspace-accent border border-dashed border-workspace-border/20 hover:border-workspace-accent/20 transition-colors disabled:opacity-50"
              >
                {browsing ? 'Loading folders...' : 'Browse Outlook Folders'}
              </button>

              {folders && (
                <div className="max-h-40 overflow-y-auto rounded border border-workspace-border/30 bg-workspace-surface/20">
                  {folders.length === 0 ? (
                    <p className="text-[9px] text-workspace-text-secondary/40 px-2 py-2 text-center">No folders found</p>
                  ) : (
                    folders.map(f => (
                      <button
                        key={f.id}
                        onClick={() => handleSelectFolder(f.displayName)}
                        className={`flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-workspace-accent/5 transition-colors border-b border-workspace-border/10 last:border-0 ${
                          f.displayName.toLowerCase() === folderName.toLowerCase() || f.displayName.split(' / ').pop()?.toLowerCase() === folderName.toLowerCase()
                            ? 'bg-workspace-accent/10 text-workspace-accent'
                            : ''
                        }`}
                      >
                        <span className="text-[10px] text-workspace-text truncate">{f.displayName}</span>
                        <span className="text-[8px] text-workspace-text-secondary/30 shrink-0 tabular-nums ml-2">{f.totalItemCount}</span>
                      </button>
                    ))
                  )}
                </div>
              )}

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

              {/* Sync error */}
              {syncError && (
                <div className="rounded px-2 py-1.5 bg-red-50 border border-red-200/50">
                  <p className="text-[9px] text-red-600">{syncError}</p>
                  {syncError.includes('expired') || syncError.includes('sign in') ? (
                    <button
                      onClick={async () => { setSyncError(null); await signInToOutlook(); }}
                      className="text-[9px] text-red-500 underline hover:text-red-700 mt-0.5"
                    >
                      Re-authenticate
                    </button>
                  ) : null}
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

              <div className="flex items-center justify-between mt-1 px-1">
                <p className="text-[8px] text-workspace-text-secondary/30">
                  {lastSync
                    ? `Last sync: ${new Date(lastSync).toLocaleString()}`
                    : 'First sync pulls emails from the selected time range.'}
                </p>
                <button
                  onClick={async () => {
                    await signOutOfOutlook();
                    setConnected(false);
                    setAccountName(null);
                    setEmailCount(null);
                    setLastSync(null);
                    setFolders(null);
                  }}
                  className="text-[8px] text-workspace-text-secondary/30 hover:text-destructive transition-colors shrink-0 ml-2"
                >
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
