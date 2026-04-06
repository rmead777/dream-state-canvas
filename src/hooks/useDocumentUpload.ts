/**
 * Shared hook for document upload handling.
 * Extracted from SherpaRail so both SherpaRail and WorkspaceBar can use it.
 */
import { useCallback } from 'react';
import { useDocuments } from '@/contexts/DocumentContext';
import { getDocument, extractDataset } from '@/lib/document-store';
import { toast } from 'sonner';

export function useDocumentUpload() {
  const { addDocument } = useDocuments();

  const handleDocumentIngested = useCallback(async (docId: string) => {
    const doc = await getDocument(docId);
    if (!doc) return;
    // addDocument updates DocumentContext — no global singleton sync needed
    addDocument(doc);

    if (doc.file_type === 'xlsx' || doc.file_type === 'csv') {
      const dataset = extractDataset(doc);
      if (dataset && dataset.rows.length > 0) {
        toast.success(`${doc.filename} loaded (${dataset.rows.length} rows)`);
      }
    }
  }, [addDocument]);

  return { handleDocumentIngested };
}
