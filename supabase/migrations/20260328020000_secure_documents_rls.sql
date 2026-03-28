-- CR-003: Secure documents table with user-scoped RLS
-- HI-003: Restrict storage bucket to allowed MIME types and authenticated users

-- 1. Add user_id column to documents table
ALTER TABLE public.documents
  ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Backfill existing documents with NULL user_id (they predate auth)
-- No action needed — NULL user_id means "legacy/unowned"

-- 3. Drop the wide-open RLS policy
DROP POLICY IF EXISTS "Allow all access to documents" ON public.documents;

-- 4. Create user-scoped RLS policies
-- Authenticated users can read their own documents
CREATE POLICY "Users can read own documents"
  ON public.documents FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Authenticated users can insert documents (user_id must match)
CREATE POLICY "Users can insert own documents"
  ON public.documents FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Authenticated users can update their own documents
CREATE POLICY "Users can update own documents"
  ON public.documents FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Authenticated users can delete their own documents
CREATE POLICY "Users can delete own documents"
  ON public.documents FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 5. Drop wide-open storage policies
DROP POLICY IF EXISTS "Allow public upload to documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read from documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow public delete from documents" ON storage.objects;

-- 6. Create authenticated storage policies
CREATE POLICY "Authenticated users can upload documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'documents');

CREATE POLICY "Authenticated users can read documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'documents');

CREATE POLICY "Authenticated users can delete own documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'documents');

-- 7. Update storage bucket: set private + allowed MIME types
UPDATE storage.buckets
SET
  public = false,
  allowed_mime_types = ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp'
  ]
WHERE id = 'documents';
