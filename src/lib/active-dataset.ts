/**
 * Active dataset store — a simple reactive store that holds the current
 * dataset being used by the workspace. This replaces direct CANONICAL_DATASET
 * imports in non-React code (intent engine, sherpa engine, etc.)
 */
import { CANONICAL_DATASET } from './seed-data';
import { getDocument, extractDataset } from './document-store';

interface Dataset {
  columns: string[];
  rows: string[][];
  sourceLabel: string;
  sourceDocId: string | null;
}

type Listener = () => void;

let current: Dataset = {
  columns: CANONICAL_DATASET.columns,
  rows: CANONICAL_DATASET.rows,
  sourceLabel: 'INCOA AP Vendor Tracker v14',
  sourceDocId: null,
};

const listeners = new Set<Listener>();

export function getActiveDataset(): Dataset {
  return current;
}

/**
 * Get dataset for a specific document ID, or the active dataset if no ID given.
 * Used by queryDataset and joinDatasets tools to support multi-document queries.
 */
export async function getDataset(documentId?: string): Promise<Dataset> {
  if (!documentId) return current;

  const doc = await getDocument(documentId);
  if (!doc) return current; // graceful fallback

  const extracted = extractDataset(doc);
  if (!extracted) return current;

  return {
    columns: extracted.columns,
    rows: extracted.rows,
    sourceLabel: doc.filename,
    sourceDocId: doc.id,
  };
}

export function setActiveDataset(ds: Dataset): void {
  current = ds;
  listeners.forEach((fn) => fn());
}

export function subscribeDataset(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
