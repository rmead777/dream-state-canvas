-- AP Email Storage — caches Outlook emails from the Incoa AP folder
-- Full body text stored for AI analysis. Synced via Graph API from client.

CREATE TABLE IF NOT EXISTS ap_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Graph API message ID — used for dedup
  graph_message_id TEXT NOT NULL UNIQUE,
  -- Email metadata
  subject TEXT,
  sender_name TEXT,
  sender_address TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  importance TEXT DEFAULT 'normal',
  has_attachments BOOLEAN DEFAULT false,
  is_read BOOLEAN DEFAULT true,
  -- Full content
  body_preview TEXT,
  body_text TEXT,
  body_content_type TEXT DEFAULT 'text',
  -- Recipients
  to_recipients JSONB DEFAULT '[]',
  -- Folder it was pulled from
  folder_name TEXT DEFAULT 'Incoa AP Automated',
  -- Which user synced this
  user_id TEXT NOT NULL,
  -- Timestamps
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by date (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_ap_emails_received_at ON ap_emails (received_at DESC);

-- Index for sender searches
CREATE INDEX IF NOT EXISTS idx_ap_emails_sender ON ap_emails (sender_address);

-- Index for user scoping
CREATE INDEX IF NOT EXISTS idx_ap_emails_user ON ap_emails (user_id);

-- Index for folder filtering
CREATE INDEX IF NOT EXISTS idx_ap_emails_folder ON ap_emails (folder_name);

-- Full-text search index on subject + body
CREATE INDEX IF NOT EXISTS idx_ap_emails_fts ON ap_emails
  USING GIN (to_tsvector('english', COALESCE(subject, '') || ' ' || COALESCE(body_text, '')));

-- Sync state — tracks last successful sync per user+folder
CREATE TABLE IF NOT EXISTS ap_email_sync (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  folder_name TEXT NOT NULL DEFAULT 'Incoa AP Automated',
  last_sync_at TIMESTAMPTZ,
  last_message_date TIMESTAMPTZ,
  emails_synced INTEGER DEFAULT 0,
  sync_status TEXT DEFAULT 'idle',
  last_error TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, folder_name)
);

-- Disable RLS for now (same as other DSC tables — internal tool)
ALTER TABLE ap_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap_email_sync ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users
DO $$ BEGIN
  CREATE POLICY "ap_emails_all" ON ap_emails FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "ap_email_sync_all" ON ap_email_sync FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
