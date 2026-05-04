/**
 * qbo-oauth-start — Begin the QuickBooks OAuth flow for DSC.
 *
 * Generates a CSRF-protected state token, stores it in qbo_oauth_state
 * with the caller's user id and a return_to URL, and returns the Intuit
 * authorization URL the frontend should redirect to.
 *
 * Auth: requires a valid Supabase session JWT. Any signed-in user can
 * initiate the flow — this is an internal tool with a small user base.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Generate a cryptographically random state token (URL-safe).
function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const clientId = Deno.env.get('QUICKBOOKS_CLIENT_ID');

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'Server not configured: Supabase env vars missing' }, 500);
    }
    if (!clientId) {
      return json({ error: 'Server not configured: QUICKBOOKS_CLIENT_ID missing' }, 500);
    }

    // Authenticate caller
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Missing auth token' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json({ error: 'Invalid auth token' }, 401);
    }

    // Parse return_to (where to redirect the user after OAuth completes).
    // Defaults to the request's origin if not provided.
    const body = (await req.json().catch(() => ({}))) as { returnTo?: string };
    const returnTo =
      typeof body.returnTo === 'string' && body.returnTo.startsWith('http')
        ? body.returnTo
        : (req.headers.get('origin') ?? '/');

    // Generate + store state
    const state = randomState();
    const { error: stateErr } = await admin.from('qbo_oauth_state').insert({
      state,
      initiated_by: userData.user.id,
      return_to: returnTo,
    });
    if (stateErr) {
      return json({ error: `Failed to store oauth state: ${stateErr.message}` }, 500);
    }

    // Build Intuit authorization URL.
    // Note: redirect_uri MUST match what's registered in the Intuit dashboard.
    const redirectUri = `${supabaseUrl}/functions/v1/qbo-oauth-callback`;
    const authParams = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: 'com.intuit.quickbooks.accounting',
      redirect_uri: redirectUri,
      state,
    });
    const authUrl = `https://appcenter.intuit.com/connect/oauth2?${authParams.toString()}`;

    return json({ authUrl, state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    console.error('qbo-oauth-start error:', err);
    return json({ error: msg }, 500);
  }
});
