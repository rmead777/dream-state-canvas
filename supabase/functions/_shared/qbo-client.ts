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
 * Refreshes automatically if expiring within 5 minutes.
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

  // Check if token needs refresh (5-minute buffer)
  const expiresAt = new Date(connection.token_expires_at);
  const now = new Date();
  const fiveMinutes = 5 * 60 * 1000;

  if (expiresAt.getTime() - now.getTime() > fiveMinutes) {
    return { token: connection.access_token, connection };
  }

  // Refresh the token
  console.log('Refreshing QuickBooks token via WCW...');

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
    console.error('Token refresh failed:', errorText);

    // DO NOT modify WCW's connection status — that's WCW's responsibility.
    // DSC is a guest reading WCW's token. If refresh fails, just report the error.
    throw new Error('QuickBooks token refresh failed. The refresh token may be expired — reconnect in Working Capital Wizard.');
  }

  const tokens = await tokenResponse.json();
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Write refreshed token back to WCW so both apps stay in sync
  await wcw
    .from('qbo_connections')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: newExpiresAt,
      last_error: null,
    })
    .eq('id', connection.id);

  console.log('Token refreshed successfully');
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
