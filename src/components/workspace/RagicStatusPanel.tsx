/**
 * RagicStatusPanel — shows Ragic CRM connection status + sync controls.
 * Reads from the ragic-status edge function (DB-only, no external API call).
 * Displayed in the Context tab of the Sherpa rail.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getRagicStatus, syncRagicOrders, syncRagicCustomers, clearRagicCache,
  updateRagicApiKey, type RagicStatusResult,
} from '@/lib/ragic-store';
import { toast } from 'sonner';

const STATUS_COLORS = {
  connected: { dot: 'bg-emerald-400', text: 'text-emerald-400/80', bg: 'bg-emerald-400/5' },
  empty: { dot: 'bg-amber-400', text: 'text-amber-400/80', bg: 'bg-amber-400/5' },
  not_connected: { dot: 'bg-red-400', text: 'text-red-400/80', bg: 'bg-red-400/5' },
};

export function RagicStatusPanel() {
  const [status, setStatus] = useState<RagicStatusResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showKeyEditor, setShowKeyEditor] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [updatingKey, setUpdatingKey] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      const result = await getRagicStatus();
      setStatus(result);
    } catch (err) {
      console.error('[RagicStatus] Failed to fetch:', err);
      setStatus({ connected: false, error: 'Failed to check Ragic connection' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleUpdateKey = async () => {
    if (!newApiKey.trim()) return;
    setUpdatingKey(true);
    try {
      const result = await updateRagicApiKey(newApiKey);
      if (result.success) {
        toast.success('Ragic API key updated. Run a sync to verify it works.');
        setNewApiKey('');
        setShowKeyEditor(false);
      } else {
        toast.error(`Update failed: ${result.error}`);
      }
    } catch (err: any) {
      toast.error(`Update failed: ${err.message}`);
    } finally {
      setUpdatingKey(false);
    }
  };

  const handleSync = async (target: 'orders' | 'customers' | 'all') => {
    setSyncing(true);
    try {
      if (target === 'orders' || target === 'all') {
        const r = await syncRagicOrders();
        if (r.success) toast.success(`Synced ${r.synced} orders from Ragic`);
        else toast.error(`Order sync failed: ${r.error}`);
      }
      if (target === 'customers' || target === 'all') {
        const r = await syncRagicCustomers();
        if (r.success) toast.success(`Synced ${r.synced} customers from Ragic`);
        else toast.error(`Customer sync failed: ${r.error}`);
      }
      clearRagicCache();
      await fetchStatus();
    } catch (err: any) {
      toast.error(`Ragic sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="rounded-lg border border-workspace-border/30 bg-workspace-surface/10 p-3">
        <div className="text-[10px] text-workspace-text-secondary/40 animate-pulse">Checking Ragic...</div>
      </div>
    );
  }

  const connected = status?.connected ?? false;
  const mainColor = connected ? STATUS_COLORS.connected : STATUS_COLORS.not_connected;

  return (
    <div className={`rounded-lg border border-workspace-border/30 ${mainColor.bg} overflow-hidden`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between p-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${mainColor.dot}`} />
          <span className="text-[11px] font-medium text-workspace-text">Ragic CRM</span>
          {status?.account && (
            <span className="text-[9px] text-workspace-text-secondary/50">{status.account}</span>
          )}
        </div>
        <span className="text-[9px] text-workspace-text-secondary/30">
          {isExpanded ? '▾' : '▸'}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-workspace-border/20 px-3 pb-3 pt-2 space-y-2">
          {!connected ? (
            <div className="text-[10px] text-red-400/80">
              {status?.error || 'No Ragic connection configured.'}
            </div>
          ) : (
            <>
              {/* Source rows */}
              {status?.sources && Object.entries(status.sources).map(([key, source]) => {
                const colors = STATUS_COLORS[source.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.not_connected;
                return (
                  <div key={key} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                      <span className="text-[10px] text-workspace-text-secondary">{source.label}</span>
                    </div>
                    <span className={`text-[9px] font-mono ${colors.text}`}>
                      {source.recordCount} records
                    </span>
                  </div>
                );
              })}

              {/* Status breakdown for orders */}
              {status?.sources?.orders.statusBreakdown && Object.keys(status.sources.orders.statusBreakdown).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(status.sources.orders.statusBreakdown).map(([s, count]) => (
                    <span key={s} className="rounded bg-workspace-surface/40 px-1.5 py-0.5 text-[8px] text-workspace-text-secondary/50">
                      {s}: {count}
                    </span>
                  ))}
                </div>
              )}

              {/* Last sync */}
              {status?.lastSyncAt && (
                <div className="text-[9px] text-workspace-text-secondary/30">
                  Last sync: {new Date(status.lastSyncAt).toLocaleString()}
                </div>
              )}

              {/* Sync buttons */}
              <div className="flex gap-1.5 pt-1">
                <button
                  onClick={() => handleSync('all')}
                  disabled={syncing}
                  className="rounded-md border border-workspace-accent/30 bg-workspace-accent/10 px-2.5 py-1 text-[9px] font-medium text-workspace-accent hover:bg-workspace-accent/20 transition-colors disabled:opacity-50"
                >
                  {syncing ? 'Syncing...' : 'Sync All'}
                </button>
                <button
                  onClick={() => handleSync('orders')}
                  disabled={syncing}
                  className="rounded-md border border-workspace-border/30 px-2 py-1 text-[9px] text-workspace-text-secondary/60 hover:border-workspace-accent/20 transition-colors disabled:opacity-50"
                >
                  Orders
                </button>
                <button
                  onClick={() => handleSync('customers')}
                  disabled={syncing}
                  className="rounded-md border border-workspace-border/30 px-2 py-1 text-[9px] text-workspace-text-secondary/60 hover:border-workspace-accent/20 transition-colors disabled:opacity-50"
                >
                  Customers
                </button>
              </div>

              {/* API key editor (toggleable) */}
              <div className="pt-1 mt-1 border-t border-workspace-border/10">
                {!showKeyEditor ? (
                  <button
                    onClick={() => setShowKeyEditor(true)}
                    className="text-[9px] text-workspace-text-secondary/40 hover:text-workspace-accent/70 transition-colors"
                  >
                    Update API key
                  </button>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="password"
                        value={newApiKey}
                        onChange={(e) => setNewApiKey(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && newApiKey.trim()) handleUpdateKey(); }}
                        placeholder="Paste new Ragic API key"
                        autoComplete="off"
                        className="flex-1 rounded border border-workspace-border/30 bg-workspace-surface/40 px-2 py-1 text-[10px] text-workspace-text placeholder:text-workspace-text-secondary/30 outline-none focus:border-workspace-accent/50 font-mono"
                      />
                      <button
                        onClick={handleUpdateKey}
                        disabled={updatingKey || !newApiKey.trim()}
                        className="rounded-md border border-workspace-accent/30 bg-workspace-accent/10 px-2 py-1 text-[9px] font-medium text-workspace-accent hover:bg-workspace-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {updatingKey ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={() => { setShowKeyEditor(false); setNewApiKey(''); }}
                        disabled={updatingKey}
                        className="text-[9px] text-workspace-text-secondary/40 hover:text-workspace-text-secondary/70 px-1"
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="text-[8px] text-workspace-text-secondary/40 leading-tight">
                      Writes to the active Ragic connection row. Run a sync afterward to verify the new key works.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
