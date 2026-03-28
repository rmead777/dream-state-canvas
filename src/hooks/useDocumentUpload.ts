/**
 * Shared hook for document upload handling.
 * Extracted from SherpaRail so both SherpaRail and WorkspaceBar can use it.
 */
import { useCallback } from 'react';
import { useDocuments } from '@/contexts/DocumentContext';
import { getDocument, extractDataset } from '@/lib/document-store';
import { setActiveDataset } from '@/lib/active-dataset';
import { clearProfileCache } from '@/lib/data-analyzer';
import { invalidateProfileCache } from '@/lib/intent-engine';
import { toast } from 'sonner';

export function useDocumentUpload() {
  const { addDocument } = useDocuments();

  const handleDocumentIngested = useCallback(async (docId: string) => {
    const doc = await getDocument(docId);
    if (!doc) return;
    addDocument(doc);

    if (doc.file_type === 'xlsx' || doc.file_type === 'csv') {
      const dataset = extractDataset(doc);
      if (dataset && dataset.rows.length > 0) {
        setActiveDataset({
          columns: dataset.columns,
          rows: dataset.rows,
          sourceLabel: doc.filename,
          sourceDocId: doc.id,
        });
        clearProfileCache();
        invalidateProfileCache();
        toast.success(`${doc.filename} is now the active dataset (${dataset.rows.length} rows)`);
      }
    }
  }, [addDocument]);

  return { handleDocumentIngested };
}
