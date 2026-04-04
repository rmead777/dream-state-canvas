/**
 * QuickBooks Data Store — client-side module for fetching QB data.
 *
 * Calls the qbo-data edge function and caches results in memory
 * for the entire browser session (SPA lifetime). Data is only
 * re-fetched when the user explicitly requests a refresh.
 *
 * Warm fetch: call warmQBOCache() on app load to pre-populate
 * the summary so Sherpa has instant access on the first query.
 */

import { supabase } from '@/integrations/supabase/client';

// ─── Types ─────────────────────────────────────────────────────────────────

export type QBODataType = 'ap' | 'ar' | 'bank' | 'pnl' | 'vendors' | 'customers' | 'summary';

export interface QBOResponse {
  success: boolean;
  type: QBODataType;
  company: string;
  data: any;
  error?: string;
}

export interface QBOFinancialSummary {
  asOf: string;
  cashPosition: {
    totalCash: number;
    totalCreditCardDebt: number;
    netCash: number;
    accounts: Array<{ id: string; name: string; type: string; balance: number }>;
  };
  accountsReceivable: {
    totalOpen: number;
    openInvoiceCount: number;
    aging: Record<string, number>;
  };
  accountsPayable: {
    totalOpen: number;
    totalCredits: number;
    netAP: number;
    openBillCount: number;
    aging: Record<string, number>;
  };
  workingCapital: {
    netWorkingCapital: number;
    currentRatio: number | null;
  };
}

// ─── Session Cache (lives for entire SPA lifetime) ─────────────────────────

const cache = new Map<string, { data: QBOResponse; fetchedAt: number }>();

/** Listeners notified when cache is cleared (used by UI to re-check status). */
const refreshListeners = new Set<() => void>();

function getCached(key: string): QBOResponse | null {
  const entry = cache.get(key);
  return entry?.data ?? null;
}

function setCache(key: string, data: QBOResponse): void {
  cache.set(key, { data, fetchedAt: Date.now() });
}

/**
 * Clear the entire QB cache. Next fetch for each data type
 * will hit the QB API fresh. Call this when the user says
 * "refresh quickbooks" or clicks the Refresh button.
 */
export function clearQBOCache(): void {
  cache.clear();
  refreshListeners.forEach(fn => fn());
}

/** Subscribe to cache-clear events. Returns an unsubscribe function. */
export function onQBOCacheCleared(fn: () => void): () => void {
  refreshListeners.add(fn);
  return () => refreshListeners.delete(fn);
}

/** Check if a specific data type is already cached. */
export function isQBOCached(type: QBODataType): boolean {
  return cache.has(`${type}:{}`);
}

/** Get the timestamp when data was last fetched (null if not cached). */
export function getQBOFetchedAt(type: QBODataType): number | null {
  const entry = cache.get(`${type}:{}`);
  return entry?.fetchedAt ?? null;
}

// ─── Core Fetch ────────────────────────────────────────────────────────────

/**
 * Fetch QuickBooks data via the qbo-data edge function.
 * Returns from session cache if available. Only hits QB API
 * on the first call per data type (or after clearQBOCache).
 */
export async function fetchQBOData(
  type: QBODataType,
  options?: Record<string, any>,
): Promise<QBOResponse> {
  const cacheKey = `${type}:${JSON.stringify(options || {})}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const session = (await supabase.auth.getSession()).data.session;
  const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qbo-data`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type, options }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`QuickBooks fetch failed (${response.status}): ${errorBody}`);
  }

  const result: QBOResponse = await response.json();
  if (result.success) {
    setCache(cacheKey, result);
  }
  return result;
}

// ─── Convenience Wrappers ──────────────────────────────────────────────────

/** Get a full financial snapshot (cash + AR + AP + working capital). */
export async function getFinancialSummary(): Promise<QBOFinancialSummary> {
  const resp = await fetchQBOData('summary');
  return resp.data as QBOFinancialSummary;
}

/** Get AP bills (unpaid). */
export async function getAPData() {
  const resp = await fetchQBOData('ap');
  return resp.data;
}

/** Get AR invoices (open + recent paid). */
export async function getARData() {
  const resp = await fetchQBOData('ar');
  return resp.data;
}

/** Get bank + credit card balances. */
export async function getBankBalances() {
  const resp = await fetchQBOData('bank');
  return resp.data;
}

/** Get P&L report for a date range. */
export async function getProfitAndLoss(startDate?: string, endDate?: string) {
  const resp = await fetchQBOData('pnl', { startDate, endDate });
  return resp.data;
}

// ─── Warm Fetch ────────────────────────────────────────────────────────────

/**
 * Pre-populate the cache with the financial summary so Sherpa
 * has instant access on the first query. Call this on app load
 * after confirming the QB connection is healthy.
 *
 * Runs silently in the background — never throws.
 */
export async function warmQBOCache(): Promise<void> {
  try {
    await fetchQBOData('summary');
    console.log('[QBO] Warm fetch complete — summary cached');
  } catch (err) {
    console.warn('[QBO] Warm fetch failed (will retry on first query):', err);
  }
}
