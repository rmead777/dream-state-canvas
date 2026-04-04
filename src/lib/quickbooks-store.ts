/**
 * QuickBooks Data Store — client-side module for fetching QB data.
 *
 * Calls the qbo-data edge function and caches results in memory
 * with a short TTL so repeated AI queries don't hammer the API.
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

// ─── Cache ─────────────────────────────────────────────────────────────────

const cache = new Map<string, { data: any; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCached(key: string): any | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, fetchedAt: Date.now() });
}

/** Clear the QB cache (e.g. after a manual sync). */
export function clearQBOCache(): void {
  cache.clear();
}

// ─── Core Fetch ────────────────────────────────────────────────────────────

/**
 * Fetch QuickBooks data via the qbo-data edge function.
 * Results are cached for 5 minutes.
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

/**
 * Check if QuickBooks integration is available.
 * Returns true if the edge function responds successfully.
 */
export async function isQBOAvailable(): Promise<boolean> {
  try {
    const resp = await fetchQBOData('bank');
    return resp.success;
  } catch {
    return false;
  }
}
