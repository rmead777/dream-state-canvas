/**
 * QuickBooks API Client — shared utility for Dream State Canvas
 *
 * Reads the active QB OAuth connection from DSC's OWN Supabase
 * (qbo_connections table). DSC has its own independent OAuth grant
 * with Intuit — it does NOT share refresh tokens with WCW. This is
 * the fix for the long-standing refresh-token rotation race that used
 * to manifest as "click Sync in WCW every hour to make Sherpa work."
 *
 * Single-writer invariant: only DSC ever calls Intuit's refresh endpoint
 * for this connection. The pg_cron job calls qbo-refresh every 30 min
 * server-side, so the token is always well within its 60-min expiry.
 *
 * Lazy refresh (on-demand, < 5 min from expiry) remains as a belt-and-
 * suspenders safety net in case the cron skips a beat.
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
 * Connect to DSC's own Supabase using service role.
 * This is the single source of truth for QB OAuth state going forward.
 */
function getLocalClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Get a live QB access token from DSC's own qbo_connections table.
 * Refreshes automatically if expiring within 5 minutes.
 *
 * Pass `{ force: true }` to always refresh, regardless of expiry. Used by
 * the qbo-refresh edge function (called manually via the Sync button or
 * on a 30-minute pg_cron schedule).
 */
export async function getQBOToken(
  options?: { force?: boolean },
): Promise<{ token: string; connection: QBOConnection }> {
  const db = getLocalClient();

  // Read the active connection from DSC's own table
  const { data: connection, error } = await db
    .from('qbo_connections')
    .select('*')
    .eq('is_active', true)
    .single();

  if (error || !connection) {
    throw new Error(
      'No active QuickBooks connection found. Click "Connect QuickBooks" in the Context tab to authorize.',
    );
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
    // Mark connection as errored so the UI can show a "reconnect" prompt.
    await db
      .from('qbo_connections')
      .update({
        last_error: `Refresh failed: ${errorText.slice(0, 200)}`,
        connection_status: 'refresh_failed',
      })
      .eq('id', connection.id);
    throw new Error(
      'QuickBooks token refresh failed. The refresh token may be expired — click "Connect QuickBooks" in the Context tab to re-authorize.',
    );
  }

  const tokens = await tokenResponse.json();
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const newRefreshExpiresAt = new Date(
    Date.now() + (tokens.x_refresh_token_expires_in || 100 * 24 * 60 * 60) * 1000,
  ).toISOString();

  // Write refreshed tokens back to DSC's own table
  await db
    .from('qbo_connections')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: newExpiresAt,
      refresh_token_expires_at: newRefreshExpiresAt,
      last_error: null,
      connection_status: 'active',
    })
    .eq('id', connection.id);

  console.log('[DSC] Token refreshed successfully');
  return {
    token: tokens.access_token,
    connection: { ...connection, access_token: tokens.access_token },
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
