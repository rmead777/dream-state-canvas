/**
 * QuickBooks API Client — shared utility for Dream State Canvas
 *
 * Connects to Working Capital Wizard's Supabase to retrieve the active
 * QuickBooks OAuth token, refreshes it if needed, then calls QB API.
 * This reuses the SAME token / company / realm as WCW.
 *
 * Token refresh: DSC CAN refresh the token (same as WCW does). QB rotates
 * refresh tokens on every use, so each refresh resets the 100-day clock.
 * Race condition guard: after refreshing, we re-read the row to confirm
 * our write won (if WCW refreshed at the same instant, use theirs).
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

function getWCWClient() {
  const wcwUrl = Deno.env.get('WCW_SUPABASE_URL');
  const wcwKey = Deno.env.get('WCW_SUPABASE_SERVICE_ROLE_KEY');
  if (!wcwUrl || !wcwKey) {
    throw new Error('WCW_SUPABASE_URL and WCW_SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  return createClient(wcwUrl, wcwKey);
}

/**
 * Get a live QB access token from WCW's Supabase.
 * Refreshes automatically if expiring within 5 minutes (same logic as WCW).
 *
 * Pass `{ force: true }` to always refresh, regardless of expiry. Used by the
 * DSC "Sync QuickBooks" button to replicate WCW's sync behavior from DSC.
 */
export async function getQBOToken(
  options?: { force?: boolean },
): Promise<{ token: string; connection: QBOConnection }> {
  const wcw = getWCWClient();

  // Read active connection from WCW
  const { data: connection, error } = await wcw
    .from('qbo_connections')
    .select('*')
    .eq('is_active', true)
    .single();

  if (error || !connection) {
    throw new Error('No active QuickBooks connection found in WCW');
  }

  // Skip expiry check when force-refreshing — always hit Intuit's refresh endpoint.
  if (!options?.force) {
    const expiresAt = new Date(connection.token_expires_at);
    const now = new Date();
    const fiveMinutes = 5 * 60 * 1000;

    if (expiresAt.getTime() - now.getTime() > fiveMinutes) {
      return { token: connection.access_token, connection };
    }
  }

  // Token needs refresh
  console.log('[DSC] Refreshing QuickBooks token...');

  const clientId = Deno.env.get('QUICKBOOKS_CLIENT_ID');
  const clientSecret = Deno.env.get('QUICKBOOKS_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    throw new Error('QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET must be set');
  }

  const tokenResponse = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: connection.refresh_token,
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error('[DSC] Token refresh failed:', errorText);
    // Don't touch WCW's connection state — just report the error
    throw new Error('QuickBooks token refresh failed. The refresh token may be expired — reconnect in Working Capital Wizard.');
  }

  const tokens = await tokenResponse.json();
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const newRefreshExpiresAt = new Date(Date.now() + (tokens.x_refresh_token_expires_in || 100 * 24 * 60 * 60) * 1000).toISOString();

  // Write refreshed tokens back to WCW's table
  await wcw
    .from('qbo_connections')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: newExpiresAt,
      refresh_token_expires_at: newRefreshExpiresAt,
      last_error: null,
    })
    .eq('id', connection.id);

  // Race condition guard: re-read to confirm our write won.
  // If WCW refreshed at the same instant, their token is equally valid — use whatever is in the DB now.
  const { data: confirmed } = await wcw
    .from('qbo_connections')
    .select('access_token')
    .eq('id', connection.id)
    .single();

  const finalToken = confirmed?.access_token || tokens.access_token;

  console.log('[DSC] Token refreshed successfully');
  return {
    token: finalToken,
    connection: { ...connection, access_token: finalToken },
  };
}

// ─── QB API Helpers ────────────────────────────────────────────────────────

function getBaseUrl(connection: QBOConnection): string {
  return connection.is_sandbox
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';
}

/**
 * Run a QuickBooks query (SQL-like syntax).
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
