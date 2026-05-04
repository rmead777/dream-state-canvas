/**
 * qbo-oauth-callback — Receive Intuit's redirect after the user authorizes.
 *
 * Intuit sends: ?code=...&state=...&realmId=...
 *
 * We validate the state token, exchange the code for tokens, write the
 * connection to qbo_connections (deactivating any prior active row), and
 * redirect the user back to the app with ?qbo=connected (or ?qbo=error).
 *
 * No JWT auth here — Intuit's redirect is server→browser→here, the browser
 * is unauthenticated to Supabase. The state token is the only protection,
 * and it's sufficient because state binds this callback to the user who
 * initiated the flow.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function redirectTo(returnTo: string, params: Record<string, string>): Response {
  const url = new URL(returnTo);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return Response.redirect(url.toString(), 302);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const realmId = url.searchParams.get('realmId');
  const intuitError = url.searchParams.get('error');

  // Default return URL if we can't look up the stored state
  const fallbackReturn = req.headers.get('referer') ?? url.origin;

  // Intuit returned an error (user cancelled, app misconfigured, etc.)
  if (intuitError) {
    return redirectTo(fallbackReturn, {
      qbo: 'error',
      msg: intuitError,
    });
  }

  if (!code || !state || !realmId) {
    return redirectTo(fallbackReturn, {
      qbo: 'error',
      msg: 'Missing code, state, or realmId from Intuit',
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const clientId = Deno.env.get('QUICKBOOKS_CLIENT_ID');
  const clientSecret = Deno.env.get('QUICKBOOKS_CLIENT_SECRET');

  if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret) {
    return redirectTo(fallbackReturn, {
      qbo: 'error',
      msg: 'Server not configured: missing Supabase or Intuit credentials',
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Validate state, get return_to
  const { data: stateRow, error: stateErr } = await admin
    .from('qbo_oauth_state')
    .select('return_to, expires_at')
    .eq('state', state)
    .maybeSingle();

  if (stateErr || !stateRow) {
    return redirectTo(fallbackReturn, {
      qbo: 'error',
      msg: 'Invalid or expired OAuth state — please try again',
    });
  }

  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    await admin.from('qbo_oauth_state').delete().eq('state', state);
    return redirectTo(stateRow.return_to ?? fallbackReturn, {
      qbo: 'error',
      msg: 'OAuth state expired (over 10 minutes) — please try again',
    });
  }

  const returnTo = stateRow.return_to ?? fallbackReturn;

  // Consume the state token (one-time use)
  await admin.from('qbo_oauth_state').delete().eq('state', state);

  // 2. Exchange code for tokens
  const redirectUri = `${supabaseUrl}/functions/v1/qbo-oauth-callback`;
  const tokenResp = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResp.ok) {
    const errText = await tokenResp.text();
    console.error('qbo-oauth-callback: token exchange failed', errText);
    console.error('Diagnostic — redirect_uri sent:', redirectUri);
    console.error('Diagnostic — client_id first 8:', clientId.slice(0, 8));
    console.error('Diagnostic — client_secret length:', clientSecret.length);
    console.error('Diagnostic — code prefix:', code.slice(0, 12));
    console.error('Diagnostic — realmId:', realmId);
    // Include diagnostic in the error so Ryan sees it without having to dig in Lovable logs.
    const diag = `redirect_uri=${redirectUri} | client_id=${clientId.slice(0, 8)}… | client_secret_len=${clientSecret.length}`;
    return redirectTo(returnTo, {
      qbo: 'error',
      msg: `Token exchange failed: ${errText.slice(0, 150)} :: ${diag}`,
    });
  }

  const tokens = (await tokenResp.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in?: number;
    token_type?: string;
  };

  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const refreshExpiresAt = new Date(
    Date.now() + (tokens.x_refresh_token_expires_in ?? 100 * 24 * 60 * 60) * 1000,
  ).toISOString();

  // 3. Look up company name from QB (best-effort)
  let companyName: string | null = null;
  try {
    const companyResp = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}`,
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: 'application/json',
        },
      },
    );
    if (companyResp.ok) {
      const info = await companyResp.json();
      companyName = info?.CompanyInfo?.CompanyName ?? null;
    }
  } catch {
    // ignore — name is optional
  }

  // 4. Deactivate any prior active connection (single-owner invariant)
  await admin
    .from('qbo_connections')
    .update({ is_active: false })
    .eq('is_active', true);

  // 5. Insert the new connection
  const { error: insertErr } = await admin.from('qbo_connections').insert({
    realm_id: realmId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: tokenExpiresAt,
    refresh_token_expires_at: refreshExpiresAt,
    company_name: companyName,
    is_sandbox: false,
    is_active: true,
    connection_status: 'active',
    last_error: null,
  });

  if (insertErr) {
    console.error('qbo-oauth-callback: insert failed', insertErr);
    return redirectTo(returnTo, {
      qbo: 'error',
      msg: `Failed to save connection: ${insertErr.message}`,
    });
  }

  return redirectTo(returnTo, {
    qbo: 'connected',
    company: companyName ?? 'QuickBooks',
  });
});
