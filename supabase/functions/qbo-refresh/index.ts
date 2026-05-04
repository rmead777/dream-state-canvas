/**
 * QuickBooks Force-Refresh — triggers a token refresh from DSC.
 *
 * Calls Intuit's refresh-token endpoint unconditionally (bypasses the 5-min
 * expiry buffer), writes the new tokens to DSC's qbo_connections row, and
 * returns success/company info so the UI can update.
 *
 * Idempotent — safe to call repeatedly. Each call rotates the refresh token
 * and resets Intuit's 100-day refresh-token clock.
 *
 * Auth: accepts EITHER
 *   1. An Authorization: Bearer <jwt> header (manual Sync button from the UI), OR
 *   2. An x-cron-secret header matching the QBO_CRON_SECRET env var
 *      (the pg_cron job uses this; the secret is stored in Supabase Vault).
 *
 * The cron-secret path exists because the DSC service role key isn't
 * available to us through Lovable's UI — using a dedicated shared secret
 * for the cron is functionally equivalent for this single endpoint, and
 * narrower in blast radius.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { getQBOToken } from '../_shared/qbo-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ─── Auth gate: accept either Bearer JWT (UI) or x-cron-secret (pg_cron) ───
  const authHeader = req.headers.get('Authorization');
  const hasBearerAuth = !!authHeader && /^Bearer\s+\S+/.test(authHeader);

  const presentedCronSecret = req.headers.get('x-cron-secret');
  const expectedCronSecret = Deno.env.get('QBO_CRON_SECRET');
  const hasValidCronAuth =
    !!presentedCronSecret &&
    !!expectedCronSecret &&
    presentedCronSecret === expectedCronSecret;

  if (!hasBearerAuth && !hasValidCronAuth) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: missing Authorization or x-cron-secret header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const { connection } = await getQBOToken({ force: true });
    return new Response(
      JSON.stringify({
        success: true,
        company: connection.company_name,
        realmId: connection.realm_id,
        refreshedAt: new Date().toISOString(),
        triggeredBy: hasValidCronAuth ? 'cron' : 'user',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('qbo-refresh error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
