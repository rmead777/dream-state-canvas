/**
 * QuickBooks OAuth Callback — exchanges auth code for tokens.
 *
 * Called by the DSC `/qb-callback` page after Intuit redirects back
 * with an authorization code. We:
 *   1. Exchange code → access_token + refresh_token (server-side because
 *      the client_secret must never touch the browser).
 *   2. Fetch company name from QB's CompanyInfo endpoint for display.
 *   3. Upsert the tokens into WCW's `qbo_connections` table — preserving
 *      fields WCW cares about (user_id, is_sandbox, id, created_at) and
 *      overwriting only the token / name / expiry fields.
 *
 * WCW-safety: Realm-mismatch guard. If the existing connection is bound to
 * QB company A and DSC's OAuth returned company B, we REFUSE to write.
 * This prevents DSC from accidentally yanking WCW over to a different QB
 * realm (which would break all of WCW's existing data).
 *
 * TODO(ryan): If you want to ALLOW switching companies from DSC, replace
 * the realm-mismatch block with an `override: true` flag from the request
 * body and a UI confirmation prompt. See comment inline below.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { code, realmId, redirectUri } = await req.json();

    if (!code || !realmId || !redirectUri) {
      return new Response(
        JSON.stringify({ error: 'code, realmId, and redirectUri are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const clientId = Deno.env.get('QUICKBOOKS_CLIENT_ID');
    const clientSecret = Deno.env.get('QUICKBOOKS_CLIENT_SECRET');
    const wcwUrl = Deno.env.get('WCW_SUPABASE_URL');
    const wcwKey = Deno.env.get('WCW_SUPABASE_SERVICE_ROLE_KEY');

    if (!clientId || !clientSecret) {
      return new Response(
        JSON.stringify({ error: 'QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (!wcwUrl || !wcwKey) {
      return new Response(
        JSON.stringify({ error: 'WCW_SUPABASE_URL / WCW_SUPABASE_SERVICE_ROLE_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ─── Step 1: Exchange auth code for tokens ─────────────────────────────
    console.log('[qbo-callback] Token exchange starting', {
      clientIdPrefix: clientId.slice(0, 10),
      clientIdLength: clientId.length,
      clientSecretLength: clientSecret.length,
      redirectUri,
      codePrefix: code.slice(0, 12),
      codeLength: code.length,
      realmId,
    });
    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[qbo-callback] Token exchange failed:', {
        status: tokenResponse.status,
        body: errorText,
        clientIdPrefix: clientId.slice(0, 10),
        redirectUri,
      });
      return new Response(
        JSON.stringify({ error: `Token exchange failed: ${errorText}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const tokens = await tokenResponse.json();
    const now = Date.now();
    const newExpiresAt = new Date(now + tokens.expires_in * 1000).toISOString();
    const newRefreshExpiresAt = new Date(
      now + (tokens.x_refresh_token_expires_in || 100 * 24 * 60 * 60) * 1000,
    ).toISOString();

    // ─── Step 2: Check existing connection + realm-mismatch guard ─────────
    const wcw = createClient(wcwUrl, wcwKey);
    const existing = await wcw
      .from('qbo_connections')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();

    // WCW-SAFETY: Realm mismatch guard.
    // TODO(ryan): If you want to allow DSC to switch QB companies, replace this
    // block with a check on `body.override === true` + require a UI confirmation.
    if (existing.data && existing.data.realm_id !== realmId) {
      return new Response(
        JSON.stringify({
          error: 'REALM_MISMATCH',
          message:
            `DSC is currently bound to QuickBooks company "${existing.data.company_name}" ` +
            `(realm ${existing.data.realm_id}). You just authorized a different company ` +
            `(realm ${realmId}). To switch companies, disconnect in Working Capital Wizard first, ` +
            `then reconnect here.`,
          existingRealmId: existing.data.realm_id,
          existingCompanyName: existing.data.company_name,
          attemptedRealmId: realmId,
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ─── Step 3: Fetch company name from QB ────────────────────────────────
    // Non-fatal — if this fails we fall back to the existing name or a default.
    let companyName = existing.data?.company_name || 'QuickBooks';
    const isSandbox = existing.data?.is_sandbox ?? false;
    const qbBase = isSandbox
      ? 'https://sandbox-quickbooks.api.intuit.com'
      : 'https://quickbooks.api.intuit.com';
    try {
      const ciResp = await fetch(
        `${qbBase}/v3/company/${realmId}/companyinfo/${realmId}`,
        {
          headers: {
            'Authorization': `Bearer ${tokens.access_token}`,
            'Accept': 'application/json',
          },
        },
      );
      if (ciResp.ok) {
        const ci = await ciResp.json();
        companyName =
          ci.CompanyInfo?.CompanyName || ci.CompanyInfo?.LegalName || companyName;
      }
    } catch (e) {
      console.warn('[qbo-callback] CompanyInfo fetch failed (non-fatal):', e);
    }

    // ─── Step 4: Upsert tokens into WCW's qbo_connections ──────────────────
    const tokenFields = {
      realm_id: realmId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: newExpiresAt,
      refresh_token_expires_at: newRefreshExpiresAt,
      company_name: companyName,
      is_active: true,
      last_error: null,
    };

    if (existing.data?.id) {
      // Update existing row — preserves user_id, is_sandbox, id, created_at
      const { error } = await wcw
        .from('qbo_connections')
        .update(tokenFields)
        .eq('id', existing.data.id);
      if (error) {
        return new Response(
          JSON.stringify({ error: `Failed to update connection: ${error.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    } else {
      // No existing row — first-time connect. Default is_sandbox=false (production).
      const { error } = await wcw
        .from('qbo_connections')
        .insert({ ...tokenFields, is_sandbox: false });
      if (error) {
        return new Response(
          JSON.stringify({ error: `Failed to insert connection: ${error.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    return new Response(
      JSON.stringify({ success: true, companyName, realmId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('qbo-callback error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
