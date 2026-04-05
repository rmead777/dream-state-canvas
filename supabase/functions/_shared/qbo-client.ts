/**
 * QuickBooks API Client — shared utility for Dream State Canvas
 *
 * Connects to Working Capital Wizard's Supabase to retrieve the active
 * QuickBooks OAuth token, refreshes it if needed, then calls QB API.
 * This reuses the SAME token / company / realm as WCW.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── Token Management ──────────────────────────────────────────────────────

interface QBOConnection {
  id: string;
  user_id: string;
  realm_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  refresh_token_expires_at: string;
  company_name: string;
  is_sandbox: boolean;
  is_active: boolean;
  connection_status?: string;
  last_error: string | null;
}

/**
 * Get a live QB access token from WCW's Supabase.
 *
 * DSC is READ-ONLY on WCW's token. It never refreshes the token itself.
 * WCW manages its own token lifecycle. If the token is expired, DSC
 * reports the error and waits for WCW to refresh it.
 *
 * Why: QuickBooks rotates refresh tokens on every use. If both apps
 * try to refresh, one invalidates the other's token — a race condition
 * that was causing repeated disconnections.
 */
export async function getQBOToken(): Promise<{ token: string; connection: QBOConnection }> {
  const wcwUrl = Deno.env.get('WCW_SUPABASE_URL');
  const wcwKey = Deno.env.get('WCW_SUPABASE_SERVICE_ROLE_KEY');

  if (!wcwUrl || !wcwKey) {
    throw new Error('WCW_SUPABASE_URL and WCW_SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  const wcw = createClient(wcwUrl, wcwKey);

  // Read active connection from WCW
  const { data: connection, error } = await wcw
    .from('qbo_connections')
    .select('*')
    .eq('is_active', true)
    .single();

  if (error || !connection) {
    throw new Error('No active QuickBooks connection found in WCW');
  }

  // Check if token is expired — if so, DON'T refresh, just report it.
  // WCW will refresh its own token on its next sync cycle.
  const expiresAt = new Date(connection.token_expires_at);
  const now = new Date();

  if (expiresAt.getTime() < now.getTime()) {
    throw new Error('QuickBooks access token is expired. WCW will refresh it automatically on its next sync, or trigger a sync in WCW.');
  }

  return { token: connection.access_token, connection };
}

// ─── QB API Helpers ────────────────────────────────────────────────────────

function getBaseUrl(connection: QBOConnection): string {
  return connection.is_sandbox
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';
}

/**
 * Run a QuickBooks query (SQL-like syntax).
 * e.g. queryQBO(token, conn, "SELECT * FROM Invoice WHERE Balance > '0' MAXRESULTS 100")
 */
export async function queryQBO<T = any>(
  token: string,
  connection: QBOConnection,
  query: string,
): Promise<T> {
  const baseUrl = getBaseUrl(connection);
  const url = `${baseUrl}/v3/company/${connection.realm_id}/query?query=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`QuickBooks API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

/**
 * Fetch a QuickBooks report (e.g. AgedPayables, AgedReceivables, ProfitAndLoss).
 */
export async function fetchQBOReport(
  token: string,
  connection: QBOConnection,
  reportName: string,
  params: Record<string, string> = {},
): Promise<any> {
  const baseUrl = getBaseUrl(connection);
  const qs = new URLSearchParams(params).toString();
  const url = `${baseUrl}/v3/company/${connection.realm_id}/reports/${reportName}${qs ? '?' + qs : ''}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`QuickBooks report error ${response.status}: ${errorText}`);
  }

  return response.json();
}
