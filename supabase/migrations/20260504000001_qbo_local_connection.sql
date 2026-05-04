-- DSC takes ownership of its own QuickBooks OAuth grant.
--
-- Previously DSC read QB tokens from WCW's Supabase, which created a
-- refresh-token rotation race condition: when WCW silently refreshed,
-- the DB sometimes ended up with a fresh access_token but a STALE
-- refresh_token, causing DSC's "Sync" button to fail with "refresh
-- token expired" — even though data calls (using the access_token)
-- still worked. The user had to click WCW's Sync button to recover,
-- because WCW had a private copy of the latest refresh_token.
--
-- Fix: DSC gets its own independent OAuth grant. Same QB realm, same
-- Intuit app — just a separate refresh-token chain. WCW continues
-- doing whatever WCW does. Neither side touches the other's tokens.

-- ─── 1. qbo_connections (DSC's own copy) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qbo_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  realm_id text NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  refresh_token_expires_at timestamptz NOT NULL,
  company_name text,
  is_sandbox boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  connection_status text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Only one active connection at a time (the "sole owner" invariant)
CREATE UNIQUE INDEX IF NOT EXISTS idx_qbo_connections_one_active
  ON public.qbo_connections(is_active)
  WHERE is_active = true;

-- Bump updated_at on every write
CREATE OR REPLACE FUNCTION public.qbo_connections_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_qbo_connections_updated_at ON public.qbo_connections;
CREATE TRIGGER trg_qbo_connections_updated_at
  BEFORE UPDATE ON public.qbo_connections
  FOR EACH ROW EXECUTE FUNCTION public.qbo_connections_touch_updated_at();

-- ─── 2. qbo_oauth_state (CSRF guard for the OAuth round-trip) ────────────────
CREATE TABLE IF NOT EXISTS public.qbo_oauth_state (
  state text PRIMARY KEY,
  initiated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  return_to text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

CREATE INDEX IF NOT EXISTS idx_qbo_oauth_state_expires
  ON public.qbo_oauth_state(expires_at);

-- ─── 3. RLS: service-role-only ───────────────────────────────────────────────
-- These tables hold sensitive OAuth tokens. No client should touch them
-- directly — all access goes through edge functions using service role.
ALTER TABLE public.qbo_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qbo_oauth_state ENABLE ROW LEVEL SECURITY;
-- (Intentionally no policies — RLS denies all non-service-role access by default)

-- ─── 4. Cleanup helper for expired oauth state rows ──────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_qbo_oauth_state()
RETURNS void AS $$
  DELETE FROM public.qbo_oauth_state WHERE expires_at < now();
$$ LANGUAGE sql;

-- ─── 5. pg_cron: schedule a token refresh every 30 min ───────────────────────
-- Requires pg_cron + pg_net extensions (already enabled).
--
-- The cron calls qbo-refresh edge function with the service role key.
-- The service role key is read from Supabase Vault — it must be stored
-- there in a separate one-time SQL command (see follow-up SQL below).
--
-- Why every 30 min? QB access tokens last 60 min. Refreshing every 30 min
-- gives us ~2x safety margin and ensures the token is always well within
-- its valid window. Each refresh also rotates the refresh_token, resetting
-- Intuit's 100-day refresh-token clock — so the connection never expires
-- as long as the cron is running.

-- Schedule the refresh job (idempotent — drops existing job first if any).
DO $$
BEGIN
  PERFORM cron.unschedule('qbo-token-refresh');
EXCEPTION
  WHEN OTHERS THEN NULL; -- ok if job doesn't exist yet
END $$;

-- NOTE: After the first deployment, run the follow-up SQL block below
-- (separately, in the SQL editor) to actually create the cron job.
-- It's split out because the service role key must be stored in vault first.
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ POST-MIGRATION FOLLOW-UP — run this AFTER first OAuth completes         │
-- ├─────────────────────────────────────────────────────────────────────────┤
-- │                                                                         │
-- │ -- 5a. Store service role key in vault (one time)                       │
-- │ SELECT vault.create_secret(                                             │
-- │   '<paste-DSC-service-role-key-from-Lovable-secrets>',                  │
-- │   'qbo_cron_service_key',                                               │
-- │   'Service role key used by qbo-token-refresh cron job'                 │
-- │ );                                                                      │
-- │                                                                         │
-- │ -- 5b. Schedule the cron                                                │
-- │ SELECT cron.schedule(                                                   │
-- │   'qbo-token-refresh',                                                  │
-- │   '*/30 * * * *',                                                       │
-- │   $cron$                                                                │
-- │   SELECT net.http_post(                                                 │
-- │     url := 'https://xdnetcsecqoeifdjmwhk.supabase.co/functions/v1/qbo-refresh', │
-- │     headers := jsonb_build_object(                                      │
-- │       'Content-Type', 'application/json',                               │
-- │       'Authorization', 'Bearer ' || (                                   │
-- │         SELECT decrypted_secret FROM vault.decrypted_secrets            │
-- │         WHERE name = 'qbo_cron_service_key'                             │
-- │       )                                                                 │
-- │     )                                                                   │
-- │   ) AS request_id;                                                      │
-- │   $cron$                                                                │
-- │ );                                                                      │
-- │                                                                         │
-- │ -- 5c. Verify                                                           │
-- │ SELECT * FROM cron.job WHERE jobname = 'qbo-token-refresh';             │
-- │                                                                         │
-- └─────────────────────────────────────────────────────────────────────────┘
