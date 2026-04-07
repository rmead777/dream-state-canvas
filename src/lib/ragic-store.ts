/**
 * Ragic Data Store — client-side module for fetching Ragic orders/customers.
 *
 * Follows the quickbooks-store.ts pattern:
 * - Calls edge functions for sync operations
 * - Reads cached data from Supabase tables
 * - Session cache for frequently accessed data
 * - Explicit clear/refresh cycle
 */

import { supabase } from '@/integrations/supabase/client';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RagicOrder {
  id: string;
  ragic_id: string;
  order_number: string | null;
  customer_name: string;
  resolved_qb_customer_name: string;
  product_name: string | null;
  quantity: number;
  unit_price: number;
  total_amount: number;
  invoice_date: string | null;
  due_date: string | null;
  payment_terms: string;
  customer_po: string | null;
  status: string;
  class_name: string | null;
  delivery_date: string | null;
  cached_at: string;
}

export interface RagicCustomer {
  id: string;
  account_name: string;
  account_short_name: string | null;
  quickbooks_name: string | null;
  parent_account: string | null;
  payment_terms: string | null;
  payment_method: string | null;
  freight_terms: string | null;
  account_type: string | null;
  billing_city: string | null;
  billing_state: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  account_notes: string | null;
  po_required: boolean;
}

export type RagicDataType = 'orders' | 'customers' | 'status';

export interface RagicSyncResult {
  success: boolean;
  totalFetched?: number;
  synced?: number;
  skipped?: number;
  error?: string;
}

export interface RagicStatusResult {
  connected: boolean;
  account?: string;
  lastSyncAt?: string;
  sources?: {
    orders: { label: string; status: string; recordCount: number; statusBreakdown?: Record<string, number> };
    customers: { label: string; status: string; recordCount: number };
  };
  error?: string;
}

// ─── Session Cache ────────────────────────────────────────────────────────

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes — Ragic data is synced, not live

const cache = new Map<string, { data: any; fetchedAt: number }>();

const refreshListeners = new Set<() => void>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, fetchedAt: Date.now() });
}

export function clearRagicCache(): void {
  cache.clear();
  refreshListeners.forEach(fn => fn());
}

export function onRagicCacheCleared(fn: () => void): () => void {
  refreshListeners.add(fn);
  return () => refreshListeners.delete(fn);
}

// ─── Edge Function Callers ────────────────────────────────────────────────

async function callEdgeFunction(name: string, body?: Record<string, any>): Promise<any> {
  const session = (await supabase.auth.getSession()).data.session;
  const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : '{}',
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Ragic ${name} failed (${response.status}): ${errorBody}`);
  }

  return response.json();
}

// ─── Sync Operations ──────────────────────────────────────────────────────

/**
 * Sync orders from Ragic. Fetches from Ragic API and caches in DB.
 * Default window: 3 months back → 6 months forward.
 */
export async function syncRagicOrders(options?: {
  deliveryDateFrom?: string;
  deliveryDateTo?: string;
  statusFilter?: string;
}): Promise<RagicSyncResult> {
  const now = new Date();
  const from = options?.deliveryDateFrom || new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().split('T')[0];
  const to = options?.deliveryDateTo || new Date(now.getFullYear(), now.getMonth() + 6, 0).toISOString().split('T')[0];

  const result = await callEdgeFunction('ragic-fetch-orders', {
    deliveryDateFrom: from,
    deliveryDateTo: to,
    statusFilter: options?.statusFilter || 'All',
  });

  // Clear the cache so next read gets fresh data
  cache.delete('orders');

  return result;
}

/**
 * Sync customer profiles from Ragic.
 */
export async function syncRagicCustomers(): Promise<RagicSyncResult> {
  const result = await callEdgeFunction('ragic-sync-customers');
  cache.delete('customers');
  return result;
}

// ─── Data Reads (from Supabase cache) ─────────────────────────────────────

/**
 * Get cached orders from Supabase. Does NOT hit Ragic API.
 */
export async function getRagicOrders(options?: {
  status?: string;
  customer?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}): Promise<RagicOrder[]> {
  const cacheKey = `orders:${JSON.stringify(options || {})}`;
  const cached = getCached<RagicOrder[]>(cacheKey);
  if (cached) return cached;

  let query = supabase
    .from('ragic_orders_cache')
    .select('*')
    .order('delivery_date', { ascending: true });

  if (options?.status) {
    query = query.eq('status', options.status);
  }
  if (options?.customer) {
    query = query.ilike('customer_name', `%${options.customer}%`);
  }
  if (options?.dateFrom) {
    query = query.gte('delivery_date', options.dateFrom);
  }
  if (options?.dateTo) {
    query = query.lte('delivery_date', options.dateTo);
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Ragic orders query failed: ${error.message}`);

  const orders = (data || []) as RagicOrder[];
  setCache(cacheKey, orders);
  return orders;
}

/**
 * Get cached customer profiles from Supabase.
 */
export async function getRagicCustomers(options?: {
  search?: string;
  limit?: number;
}): Promise<RagicCustomer[]> {
  const cacheKey = `customers:${JSON.stringify(options || {})}`;
  const cached = getCached<RagicCustomer[]>(cacheKey);
  if (cached) return cached;

  let query = supabase
    .from('customer_profiles')
    .select('*')
    .order('account_name', { ascending: true });

  if (options?.search) {
    query = query.or(`account_name.ilike.%${options.search}%,quickbooks_name.ilike.%${options.search}%`);
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Ragic customers query failed: ${error.message}`);

  const customers = (data || []) as RagicCustomer[];
  setCache(cacheKey, customers);
  return customers;
}

/**
 * Get Ragic connection status. Lightweight — reads from DB only.
 */
export async function getRagicStatus(): Promise<RagicStatusResult> {
  const cached = getCached<RagicStatusResult>('status');
  if (cached) return cached;

  const result = await callEdgeFunction('ragic-status');
  setCache('status', result);
  return result;
}

/**
 * Get a summary of Ragic data for Sherpa context.
 * Returns order counts by status + total customers.
 */
export async function getRagicSummary(): Promise<{
  orderCount: number;
  customerCount: number;
  statusBreakdown: Record<string, number>;
  lastSyncAt: string | null;
}> {
  const status = await getRagicStatus();
  return {
    orderCount: status.sources?.orders.recordCount ?? 0,
    customerCount: status.sources?.customers.recordCount ?? 0,
    statusBreakdown: status.sources?.orders.statusBreakdown ?? {},
    lastSyncAt: status.lastSyncAt ?? null,
  };
}
