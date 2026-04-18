/**
 * QuickBooks Force-Refresh — triggers a token refresh from DSC.
 *
 * Mirrors WCW's "Sync" button. Calls Intuit's refresh-token endpoint
 * unconditionally (bypasses the 5-min expiry buffer), writes the new tokens
 * to the shared `qbo_connections` row, and returns success/company info so
 * the UI can update.
 *
 * Idempotent — safe to call repeatedly. Each call rotates the refresh token
 * and resets Intuit's 100-day refresh-token clock, same as WCW does.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { getQBOToken } from '../_shared/qbo-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { connection } = await getQBOToken({ force: true });
    return new Response(
      JSON.stringify({
        success: true,
        company: connection.company_name,
        realmId: connection.realm_id,
        refreshedAt: new Date().toISOString(),
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
