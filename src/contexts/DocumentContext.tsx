import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { DocumentRecord, listDocuments, getDocument, extractDataset } from '@/lib/document-store';
import { CANONICAL_DATASET } from '@/lib/seed-data';
import { setActiveDataset as setGlobalDataset } from '@/lib/active-dataset';
import { clearProfileCache } from '@/lib/data-analyzer';
import { invalidateProfileCache } from '@/lib/intent-engine';

interface ActiveDataset {
  columns: string[];
  rows: string[][];
  sourceDocId: string | null;
  sourceLabel: string;
}

interface DocumentContextValue {
  documents: DocumentRecord[];
  activeDataset: ActiveDataset;
  refreshDocuments: () => Promise<void>;
  setActiveDocumentAsDataset: (docId: string) => Promise<boolean>;
  addDocument: (doc: DocumentRecord) => void;
}

const fallbackDataset: ActiveDataset = {
  columns: CANONICAL_DATASET.columns,
  rows: CANONICAL_DATASET.rows,
  sourceDocId: null,
  sourceLabel: 'INCOA AP Vendor Tracker v14',
};

const DocumentContext = createContext<DocumentContextValue>({
  documents: [],
  activeDataset: fallbackDataset,
  refreshDocuments: async () => {},
  setActiveDocumentAsDataset: async () => false,
  addDocument: () => {},
});

export function DocumentProvider({ children }: { children: React.ReactNode }) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [activeDataset, setActiveDataset] = useState<ActiveDataset>(fallbackDataset);

  // Load documents on mount
  useEffect(() => {
    listDocuments().then((docs) => {
      setDocuments(docs);
      // If there's a spreadsheet document, use it as active dataset
      const spreadsheet = docs.find(
        (d) => (d.file_type === 'xlsx' || d.file_type === 'csv') && d.structured_data
      );
      if (spreadsheet) {
        const dataset = extractDataset(spreadsheet);
        if (dataset && dataset.rows.length > 0) {
          const ds = {
            columns: dataset.columns,
            rows: dataset.rows,
            sourceDocId: spreadsheet.id,
            sourceLabel: spreadsheet.filename,
          };
          setActiveDataset(ds);
          // Sync global store
          setGlobalDataset(ds);
          clearProfileCache();
          invalidateProfileCache();
        }
      }
    });
  }, []);

  const refreshDocuments = useCallback(async () => {
    const docs = await listDocuments();
    setDocuments(docs);
  }, []);

  const setActiveDocumentAsDataset = useCallback(async (docId: string) => {
    const doc = await getDocument(docId);
    if (!doc) return false;

    const dataset = extractDataset(doc);
    if (!dataset || dataset.rows.length === 0) return false;

    setActiveDataset({
      columns: dataset.columns,
      rows: dataset.rows,
      sourceDocId: doc.id,
      sourceLabel: doc.filename,
    });
    return true;
  }, []);

  const addDocument = useCallback((doc: DocumentRecord) => {
    setDocuments((prev) => [doc, ...prev.filter((d) => d.id !== doc.id)]);

    // If it's a spreadsheet, auto-set as active dataset
    if (doc.file_type === 'xlsx' || doc.file_type === 'csv') {
      const dataset = extractDataset(doc);
      if (dataset && dataset.rows.length > 0) {
        setActiveDataset({
          columns: dataset.columns,
          rows: dataset.rows,
          sourceDocId: doc.id,
          sourceLabel: doc.filename,
        });
      }
    }
  }, []);

  return (
    <DocumentContext.Provider
      value={{ documents, activeDataset, refreshDocuments, setActiveDocumentAsDataset, addDocument }}
    >
      {children}
    </DocumentContext.Provider>
  );
}

export function useDocuments() {
  return useContext(DocumentContext);
}
