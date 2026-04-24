-- Per-user RLS for AP emails.
--
-- Previous state: ap_emails + ap_email_sync had user_id TEXT (the Microsoft
-- account email from MSAL), BUT the RLS policy was `USING (true)` — meaning
-- any authenticated user could read any user's emails regardless of user_id.
--
-- This migration:
--   1. Adds a supabase_user_id uuid column that references auth.users(id)
--   2. Replaces the permissive policies with per-user policies keyed on
--      supabase_user_id, with grandfathering for pre-migration NULL rows
--   3. New inserts (via the updated client sync code) populate both columns
--   4. Legacy rows get claimed on next sync when the client runs
--      claimLegacyRows() against rows matching their Microsoft user_id
--
-- Net effect:
--   - Existing data stays readable until each user re-syncs (grandfather NULL)
--   - After each user's first sync under the new code, their rows are scoped
--     and invisible to other users
--   - New uploads going forward are user-scoped from the start

-- ─── 1. Add supabase_user_id to ap_emails ───────────────────────────────────
ALTER TABLE ap_emails
  ADD COLUMN IF NOT EXISTS supabase_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_ap_emails_supabase_user ON ap_emails (supabase_user_id);

-- ─── 2. Add supabase_user_id to ap_email_sync ───────────────────────────────
ALTER TABLE ap_email_sync
  ADD COLUMN IF NOT EXISTS supabase_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_ap_email_sync_supabase_user ON ap_email_sync (supabase_user_id);

-- ─── 3. Replace permissive RLS policies with per-user ones ──────────────────
DROP POLICY IF EXISTS "ap_emails_all" ON ap_emails;
DROP POLICY IF EXISTS "ap_email_sync_all" ON ap_email_sync;

-- ap_emails: users see their own rows + legacy NULL rows (grandfathered)
-- Inserts must always set supabase_user_id = auth.uid()
CREATE POLICY "ap_emails_own_or_legacy" ON ap_emails
  FOR SELECT
  USING (supabase_user_id IS NULL OR supabase_user_id = auth.uid());

CREATE POLICY "ap_emails_insert_own" ON ap_emails
  FOR INSERT
  WITH CHECK (supabase_user_id = auth.uid());

CREATE POLICY "ap_emails_update_own_or_legacy" ON ap_emails
  FOR UPDATE
  USING (supabase_user_id IS NULL OR supabase_user_id = auth.uid())
  WITH CHECK (supabase_user_id = auth.uid());

CREATE POLICY "ap_emails_delete_own" ON ap_emails
  FOR DELETE
  USING (supabase_user_id = auth.uid());

-- ap_email_sync: same pattern
CREATE POLICY "ap_email_sync_own_or_legacy" ON ap_email_sync
  FOR SELECT
  USING (supabase_user_id IS NULL OR supabase_user_id = auth.uid());

CREATE POLICY "ap_email_sync_insert_own" ON ap_email_sync
  FOR INSERT
  WITH CHECK (supabase_user_id = auth.uid());

CREATE POLICY "ap_email_sync_update_own_or_legacy" ON ap_email_sync
  FOR UPDATE
  USING (supabase_user_id IS NULL OR supabase_user_id = auth.uid())
  WITH CHECK (supabase_user_id = auth.uid());

CREATE POLICY "ap_email_sync_delete_own" ON ap_email_sync
  FOR DELETE
  USING (supabase_user_id = auth.uid());
