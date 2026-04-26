/**
 * OutlookStatusPanel — shows Outlook email connection status
 * in the Context tab of the Sherpa rail.
 *
 * Shows: signed-in account, active folder, stored email count,
 * last sync time, folder selector, sign-in/sync buttons.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  isOutlookConnected, getOutlookAccount, signInToOutlook, signOutOfOutlook,
  syncEmails, getStoredEmailCount, getSyncState, getAllowedEmailFolder,
  hasUserSetFolder, setAllowedEmailFolder, listMailFolders,
  type MailFolder,
} from '@/lib/email-store';

export function OutlookStatusPanel() {
  const [connected, setConnected] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [emailCount, setEmailCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [folderName, setFolderName] = useState(getAllowedEmailFolder());
  const [folderConfigured, setFolderConfigured] = useState(hasUserSetFolder());
  const [folderError, setFolderError] = useState<string | null>(null);
  const [syncDays, setSyncDays] = useState(90);

  // Folder picker state
  const [picking, setPicking] = useState(false);
  const [folderList, setFolderList] = useState<MailFolder[] | null>(null);
  const [folderListLoading, setFolderListLoading] = useState(false);
  const [folderListError, setFolderListError] = useState<string | null>(null);
  const [pendingFolder, setPendingFolder] = useState<string>('');
  const [manualEntry, setManualEntry] = useState(false);

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

  const handleFetchFolders = useCallback(async () => {
    setFolderListLoading(true);
    setFolderListError(null);
    try {
      const folders = await listMailFolders();
      setFolderList(folders);
    } catch (e: any) {
      setFolderListError(e?.message || 'Could not load folders from Outlook.');
    } finally {
      setFolderListLoading(false);
    }
  }, []);

  const handleStartPick = () => {
    setFolderError(null);
    setPendingFolder(folderName);
    setPicking(true);
    if (!folderList) handleFetchFolders();
  };

  const handleConfirmPick = () => {
    setFolderError(null);
    const trimmed = pendingFolder.trim();
    if (!trimmed) {
      setFolderError('Pick a folder before saving.');
      return;
    }
    try {
      setAllowedEmailFolder(trimmed);
      setFolderName(trimmed);
      setFolderConfigured(true);
      setEmailCount(null); // Different folder → different stored count
      setLastSync(null);   // Force re-sync prompt
      setPicking(false);
      setPendingFolder('');
      setManualEntry(false);
    } catch (e: any) {
      setFolderError(e?.message || 'Failed to save folder.');
    }
  };

  const handleCancelPick = () => {
    setPicking(false);
    setPendingFolder('');
    setFolderError(null);
    setManualEntry(false);
  };

  // First-time setup: auto-open the picker once Outlook connects so the user
  // sees the folder list immediately instead of having to click "Change."
  useEffect(() => {
    if (connected && !folderConfigured && !picking) {
      setPicking(true);
      if (!folderList) handleFetchFolders();
    }
  }, [connected, folderConfigured, picking, folderList, handleFetchFolders]);

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

              {/* Folder — picker dropdown when picking (or first-time), summary otherwise */}
              {picking || !folderConfigured ? (
                <div className="space-y-1.5 rounded px-2 py-2 bg-workspace-surface/30 border border-workspace-accent/20">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-workspace-text-secondary/60 shrink-0">Folder:</span>
                    {manualEntry ? (
                      <input
                        type="text"
                        value={pendingFolder}
                        onChange={(e) => { setPendingFolder(e.target.value); setFolderError(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmPick(); }}
                        autoFocus
                        placeholder="e.g. Inbox / INCOA / AP Automated"
                        className="flex-1 bg-transparent text-[10px] text-workspace-text placeholder:text-workspace-text-secondary/30 outline-none border-b border-workspace-border/20 focus:border-workspace-accent/50"
                      />
                    ) : folderListLoading ? (
                      <span className="flex-1 text-[10px] text-workspace-text-secondary/50">Loading folders…</span>
                    ) : folderList && folderList.length > 0 ? (
                      <select
                        value={pendingFolder}
                        onChange={(e) => { setPendingFolder(e.target.value); setFolderError(null); }}
                        className="flex-1 bg-transparent text-[10px] text-workspace-text outline-none cursor-pointer border-b border-workspace-border/20 focus:border-workspace-accent/50"
                      >
                        <option value="">— pick a folder —</option>
                        {[...folderList]
                          .sort((a, b) => a.displayName.localeCompare(b.displayName))
                          .map((f) => (
                            <option key={f.id} value={f.displayName}>
                              {f.displayName} ({f.totalItemCount.toLocaleString()})
                            </option>
                          ))}
                      </select>
                    ) : folderListError ? (
                      <button
                        onClick={handleFetchFolders}
                        className="flex-1 text-left text-[10px] text-red-400 hover:text-red-300 underline"
                      >
                        Retry
                      </button>
                    ) : (
                      <span className="flex-1 text-[10px] text-workspace-text-secondary/50">No folders found.</span>
                    )}
                  </div>

                  {/* Manual-entry toggle — escape hatch for shared mailboxes,
                      hidden folders, or anything Graph didn't surface */}
                  <button
                    onClick={() => {
                      setManualEntry(!manualEntry);
                      setPendingFolder('');
                      setFolderError(null);
                    }}
                    className="text-[9px] text-workspace-accent/60 hover:text-workspace-accent transition-colors px-1"
                  >
                    {manualEntry ? '← Pick from list instead' : "Can't find it? Type folder name →"}
                  </button>
                  {folderListError && (
                    <p className="text-[9px] text-red-400/70 px-1">{folderListError}</p>
                  )}
                  {folderError && (
                    <p className="text-[9px] text-red-400/70 px-1">{folderError}</p>
                  )}
                  <div className="flex items-center justify-between gap-2 px-1">
                    <p className="text-[8px] text-workspace-text-secondary/40 leading-tight">
                      {folderConfigured
                        ? 'Switching folders resets sync state for this folder.'
                        : 'Pick any folder in your mailbox to start syncing.'}
                    </p>
                    <div className="flex items-center gap-3 shrink-0">
                      {folderConfigured && (
                        <button
                          onClick={handleCancelPick}
                          className="text-[9px] text-workspace-text-secondary/50 hover:text-workspace-text transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        onClick={handleConfirmPick}
                        disabled={!pendingFolder.trim() || folderListLoading}
                        className="text-[9px] text-workspace-accent hover:text-workspace-accent/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded px-2 py-1 bg-workspace-surface/30">
                  <span className="text-[9px] text-workspace-text-secondary/40 shrink-0">Folder:</span>
                  <span className="flex-1 text-[10px] text-workspace-text truncate">
                    {folderName}
                  </span>
                  <span className="text-[8px] text-workspace-text-secondary/40 shrink-0 tabular-nums">
                    {emailCount != null ? `${emailCount}` : '—'}
                  </span>
                  <button
                    onClick={handleStartPick}
                    className="text-[9px] text-workspace-accent/70 hover:text-workspace-accent transition-colors shrink-0"
                    title="Pick a different folder"
                  >
                    Change
                  </button>
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

              {/* Sync button — requires folder configured */}
              <button
                onClick={handleSync}
                disabled={loading || !folderConfigured}
                className="w-full mt-1 rounded px-2 py-1 text-[9px] text-workspace-text-secondary/50 hover:text-workspace-accent border border-workspace-border/20 hover:border-workspace-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={!folderConfigured ? 'Pick a folder above before syncing' : undefined}
              >
                {loading ? 'Syncing...' : !folderConfigured ? 'Pick a folder first' : lastSync ? 'Sync New Emails' : 'Initial Sync'}
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
