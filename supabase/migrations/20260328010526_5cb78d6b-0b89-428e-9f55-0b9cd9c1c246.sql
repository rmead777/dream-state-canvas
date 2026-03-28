
-- Documents table for storing uploaded files and their AI analysis
CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  mime_type text NOT NULL,
  file_type text NOT NULL CHECK (file_type IN ('xlsx', 'csv', 'pdf', 'docx', 'txt', 'md', 'image')),
  storage_path text NOT NULL,
  extracted_text text DEFAULT '',
  structured_data jsonb DEFAULT '{}'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  data_profile jsonb,
  fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Allow public access (no auth required for this workspace app)
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to documents"
  ON public.documents
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Storage bucket for raw files
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('documents', 'documents', true, 20971520);

-- Storage RLS: allow public upload/read
CREATE POLICY "Allow public upload to documents"
  ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'documents');

CREATE POLICY "Allow public read from documents"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'documents');

CREATE POLICY "Allow public delete from documents"
  ON storage.objects
  FOR DELETE
  USING (bucket_id = 'documents');
