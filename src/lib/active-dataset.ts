/**
 * Dataset Loader — utility for fetching a specific document's data by ID.
 *
 * There is NO global "active dataset" singleton. Every data access must
 * reference a document by ID. This file only provides getDataset(docId)
 * for resolving a document from Supabase.
 *
 * For the UI's "which document is selected" state, see DocumentContext.
 */
import { getDocument, extractDataset } from './document-store';

export interface Dataset {
  columns: string[];
  rows: string[][];
  sourceLabel: string;
  sourceDocId: string | null;
}

/**
 * Get dataset for a specific document ID.
 * Returns null if document not found or has no extractable data.
 */
export async function getDataset(documentId: string): Promise<Dataset | null> {
  const doc = await getDocument(documentId);
  if (!doc) {
    console.warn(`[dataset-loader] Document ${documentId} not found`);
    return null;
  }

  const extracted = extractDataset(doc);
  if (!extracted) {
    console.warn(`[dataset-loader] Could not extract data from ${documentId}`);
    return null;
  }

  return {
    columns: extracted.columns,
    rows: extracted.rows,
    sourceLabel: doc.filename,
    sourceDocId: doc.id,
  };
}
