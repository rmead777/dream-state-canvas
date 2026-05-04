/**
 * peek-env — One-shot environment variable extractor.
 *
 * ⚠️ TEMPORARY — DELETE THIS FUNCTION FROM THE REPO AND FROM LOVABLE
 *    IMMEDIATELY AFTER YOU'VE EXTRACTED THE VALUES YOU NEED.
 *
 * Lovable Cloud doesn't expose the auto-injected SUPABASE_SERVICE_ROLE_KEY
 * (and a few other auto-managed env vars) in its secrets UI. This function
 * is a deliberate, audited workaround: gated by the existing
 * CLONE_PROFILE_PASSPHRASE so it can't be called by anyone else, and it
 * logs nothing — values flow through env → response, never through stdout.
 *
 * Usage:
 *   POST /functions/v1/peek-env
 *   {
 *     "passphrase": "<your CLONE_PROFILE_PASSPHRASE value>",
 *     "vars": ["SUPABASE_SERVICE_ROLE_KEY"]   // optional; defaults to this
 *   }
 *
 * Response: { "vars": { "SUPABASE_SERVICE_ROLE_KEY": "eyJ..." } }
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Allowlist of env vars this function will reveal. Keeps the blast radius
// tight — no one can ask for arbitrary env vars even with the passphrase.
const PEEKABLE_VARS = new Set([
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
]);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const expected = Deno.env.get('CLONE_PROFILE_PASSPHRASE');
  if (!expected) {
    return json({ error: 'Server not configured: CLONE_PROFILE_PASSPHRASE missing' }, 500);
  }

  const body = (await req.json().catch(() => ({}))) as {
    passphrase?: string;
    vars?: unknown;
  };

  if (!body.passphrase || body.passphrase !== expected) {
    return json({ error: 'Invalid passphrase' }, 403);
  }

  const requestedRaw =
    Array.isArray(body.vars) && body.vars.length > 0
      ? (body.vars as unknown[]).filter((v): v is string => typeof v === 'string')
      : ['SUPABASE_SERVICE_ROLE_KEY'];

  const result: Record<string, string | null> = {};
  for (const name of requestedRaw) {
    if (!PEEKABLE_VARS.has(name)) {
      result[name] = null; // intentionally not in allowlist — refuse silently
      continue;
    }
    result[name] = Deno.env.get(name) ?? null;
  }

  return json({
    vars: result,
    reminder: 'Delete this peek-env function from the repo and from Lovable now that you have what you need.',
  });
});
