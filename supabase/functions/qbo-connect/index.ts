/**
 * QuickBooks OAuth Initiation — builds the Intuit authorize URL.
 *
 * Client provides a CSRF `state` (UUID) and the `redirectUri` (DSC's
 * callback page). We return the full authorize URL with the registered
 * `client_id` attached. Client navigates the browser there; Intuit
 * shows its consent screen; upon approval Intuit redirects back to
 * `${redirectUri}?code=...&realmId=...&state=...`.
 *
 * The caller's `redirectUri` is relayed as-is — Intuit enforces the
 * whitelist of registered URIs on its side, so only URIs registered
 * in the Intuit Developer Console (WCW's + DSC's) will be accepted.
 *
 * Scopes: Accounting API only. Matches what `qbo-client.ts` uses for
 * queries + reports. If we ever need Payments or Payroll APIs, add them here.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const QBO_SCOPES = 'com.intuit.quickbooks.accounting';
const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { redirectUri, state } = await req.json();

    if (!redirectUri || typeof redirectUri !== 'string') {
      return new Response(
        JSON.stringify({ error: 'redirectUri is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (!state || typeof state !== 'string' || state.length < 16) {
      return new Response(
        JSON.stringify({ error: 'state is required (min 16 chars, use crypto.randomUUID())' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const clientId = Deno.env.get('QUICKBOOKS_CLIENT_ID');
    if (!clientId) {
      return new Response(
        JSON.stringify({ error: 'QUICKBOOKS_CLIENT_ID env var not set on DSC Supabase' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: QBO_SCOPES,
      redirect_uri: redirectUri,
      state,
    });

    return new Response(
      JSON.stringify({ authorizeUrl: `${AUTHORIZE_URL}?${params.toString()}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('qbo-connect error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
