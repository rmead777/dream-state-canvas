/**
 * Document Store — manages uploading files to storage, calling the ingestion
 * edge function, and loading documents from the database.
 */
import { supabase } from '@/integrations/supabase/client';

export interface DocumentRecord {
  id: string;
  filename: string;
  mime_type: string;
  file_type: string;
  storage_path: string;
  extracted_text: string;
  structured_data: Record<string, unknown>;
  metadata: Record<string, unknown>;
  data_profile: Record<string, unknown> | null;
  fingerprint: string | null;
  created_at: string;
}

type FileType = 'xlsx' | 'csv' | 'pdf' | 'docx' | 'txt' | 'md' | 'image';

export interface DocumentObjectContext {
  sourceDocId: string;
  fileName: string;
  fileType: string;
  summary: string;
  paragraphs: string[];
  storagePath: string;
  mimeType: string;
}

function detectFileType(file: File): FileType {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const mime = file.type;

  if (ext === 'xlsx' || ext === 'xls' || mime.includes('spreadsheet') || mime.includes('excel')) return 'xlsx';
  if (ext === 'csv' || mime === 'text/csv') return 'csv';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === 'docx' || mime.includes('wordprocessingml')) return 'docx';
  if (ext === 'md') return 'md';
  if (mime.startsWith('image/')) return 'image';
  return 'txt';
}

function normalizeFileStem(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getPreferredFileType(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes('pdf') || lower.includes('report') || lower.includes('document')) return 'pdf';
  if (lower.includes('excel') || lower.includes('spreadsheet') || lower.includes('xlsx')) return 'xlsx';
  if (lower.includes('csv')) return 'csv';
  return null;
}

function splitDocumentParagraphs(text: string): string[] {
  const normalized = text.replace(/\r/g, '').trim();
  if (!normalized) return [];

  const paragraphSplit = normalized
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (paragraphSplit.length >= 2) return paragraphSplit.slice(0, 120);

  return normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 120);
}

function stripMarkdownCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) return trimmed;

  const withoutOpeningFence = trimmed.replace(/^```[a-zA-Z0-9_-]*\s*/u, '');
  return withoutOpeningFence.replace(/\s*```$/u, '').trim();
}

function extractBalancedJsonObject(value: string): string | null {
  const start = value.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < value.length; i += 1) {
    const char = value[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, i + 1);
      }
    }
  }

  return null;
}

interface ParsedDocumentPayload {
  summary?: string;
  extractedText?: string;
  structuredInsights?: {
    sections?: string[];
  };
}

function parseDocumentPayload(raw: string): ParsedDocumentPayload | null {
  const candidates = [raw.trim(), stripMarkdownCodeFence(raw)];

  for (const candidate of candidates) {
    if (!candidate) continue;

    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed === 'string') {
        const reparsed = JSON.parse(parsed) as ParsedDocumentPayload;
        return reparsed;
      }
      return parsed as ParsedDocumentPayload;
    } catch {
      const extracted = extractBalancedJsonObject(candidate);
      if (!extracted) continue;

      try {
        return JSON.parse(extracted) as ParsedDocumentPayload;
      } catch {
        continue;
      }
    }
  }

  return null;
}

export function buildDocumentObjectContext(doc: DocumentRecord): DocumentObjectContext {
  const metadata = (doc.metadata || {}) as { aiSummary?: string; summary?: string };
  const parsedPayload = parseDocumentPayload(doc.extracted_text || '');
  const normalizedText =
    parsedPayload?.extractedText?.trim() ||
    parsedPayload?.structuredInsights?.sections?.join('\n\n')?.trim() ||
    (parsedPayload ? '' : doc.extracted_text || '');
  const paragraphs = splitDocumentParagraphs(normalizedText || metadata.summary || '');
  const summary =
    metadata.aiSummary?.trim() ||
    metadata.summary?.trim() ||
    parsedPayload?.summary?.trim() ||
    paragraphs[0] ||
    'No summary available.';

  return {
    sourceDocId: doc.id,
    fileName: doc.filename,
    fileType: doc.file_type,
    summary,
    paragraphs,
    storagePath: doc.storage_path,
    mimeType: doc.mime_type,
  };
}

export async function resolveDocumentRecord(options: {
  title?: string;
  query?: string;
  preferredIds?: string[];
} = {}): Promise<DocumentRecord | null> {
  const { title = '', query = '', preferredIds = [] } = options;
  const docs = await listDocuments();
  const scopedDocs = preferredIds.length > 0
    ? docs.filter((doc) => preferredIds.includes(doc.id))
    : docs;
  const candidates = scopedDocs.length > 0 ? scopedDocs : docs;

  if (candidates.length === 0) return null;

  const titleStem = normalizeFileStem(title);
  const queryStem = normalizeFileStem(query);
  const hintedType = getPreferredFileType(`${title} ${query}`);

  const scored = candidates
    .map((doc) => {
      const filenameStem = normalizeFileStem(doc.filename);
      let score = 0;

      if (titleStem) {
        if (filenameStem === titleStem) score += 120;
        if (filenameStem.includes(titleStem) || titleStem.includes(filenameStem)) score += 60;
      }

      if (queryStem) {
        if (queryStem.includes(filenameStem) || filenameStem.includes(queryStem)) score += 35;
      }

      if (hintedType) {
        if (hintedType === 'pdf' && doc.file_type === 'pdf') score += 30;
        if (hintedType === 'xlsx' && (doc.file_type === 'xlsx' || doc.file_type === 'csv')) score += 30;
        if (hintedType === 'csv' && doc.file_type === 'csv') score += 30;
      }

      if (query.toLowerCase().includes('source document') && doc.file_type === 'pdf') score += 15;
      if (query.toLowerCase().includes('dataset') && (doc.file_type === 'xlsx' || doc.file_type === 'csv')) score += 15;

      return { doc, score };
    })
    .sort((a, b) => b.score - a.score);

  if (scored[0]?.score > 0) return scored[0].doc;

  if (hintedType === 'pdf') return candidates.find((doc) => doc.file_type === 'pdf') || candidates[0];
  if (hintedType === 'xlsx') return candidates.find((doc) => doc.file_type === 'xlsx' || doc.file_type === 'csv') || candidates[0];
  if (hintedType === 'csv') return candidates.find((doc) => doc.file_type === 'csv') || candidates[0];

  return candidates[0];
}

/**
 * Parse an XLSX file client-side using SheetJS (loaded dynamically).
 * Returns all worksheets with headers and rows.
 */
async function parseXLSXClientSide(file: File): Promise<Record<string, { headers: string[]; rows: string[][] }>> {
  // Dynamically import SheetJS from CDN
  // @ts-ignore - dynamic CDN import
  const XLSX = await import(/* @vite-ignore */ 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  const sheets: Record<string, { headers: string[]; rows: string[][] }> = {};

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const jsonData: string[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    if (jsonData.length === 0) {
      sheets[sheetName] = { headers: [], rows: [] };
      continue;
    }

    const headers = jsonData[0].map((h: unknown) => String(h || ''));
    const rows = jsonData.slice(1).map((row: unknown[]) => row.map((cell: unknown) => String(cell ?? '')));

    // Skip completely empty sheets
    if (headers.every((h) => !h) && rows.length === 0) continue;

    sheets[sheetName] = { headers, rows };
  }

  return sheets;
}

/**
 * Read file as text.
 */
function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/**
 * Read file as base64.
 */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export interface UploadProgress {
  stage: 'uploading' | 'analyzing' | 'done' | 'error';
  filename: string;
  message: string;
}

/**
 * Upload and ingest a document. Returns the document record.
 */
export async function uploadDocument(
  file: File,
  onProgress?: (p: UploadProgress) => void
): Promise<DocumentRecord | null> {
  const fileType = detectFileType(file);
  const storagePath = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  try {
    // 1. Upload to storage
    onProgress?.({ stage: 'uploading', filename: file.name, message: 'Uploading file...' });

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, file, { contentType: file.type });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      onProgress?.({ stage: 'error', filename: file.name, message: 'Upload failed' });
      return null;
    }

    // 2. Prepare content for ingestion
    onProgress?.({ stage: 'analyzing', filename: file.name, message: 'AI is reading and analyzing...' });

    const payload: Record<string, unknown> = {
      filename: file.name,
      mimeType: file.type,
      fileType,
      storagePath,
    };

    if (fileType === 'xlsx') {
      // Parse ALL sheets client-side and send structured data
      const parsedSheets = await parseXLSXClientSide(file);
      payload.parsedSheets = parsedSheets;
    } else if (fileType === 'csv' || fileType === 'txt' || fileType === 'md') {
      payload.textContent = await readAsText(file);
    } else if (fileType === 'pdf' || fileType === 'image') {
      payload.base64Content = await readAsBase64(file);
    } else if (fileType === 'docx') {
      // For DOCX, send as base64 — the edge function can use AI vision
      payload.base64Content = await readAsBase64(file);
      // Also try to extract text if possible
      try {
        payload.textContent = await readAsText(file);
      } catch (e) { console.warn('[document-store] Failed to read as text (binary doc), falling back to base64:', e); }
    }

    // 3. Call ingestion edge function
    const resp = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest-document`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Ingestion failed' }));
      console.error('Ingestion error:', err);
      onProgress?.({ stage: 'error', filename: file.name, message: err.error || 'Analysis failed' });
      return null;
    }

    const result = await resp.json();

    if (result.status === 'duplicate') {
      onProgress?.({ stage: 'done', filename: file.name, message: 'Document already exists' });
      // Fetch the existing document
      const existing = await getDocument(result.id);
      return existing;
    }

    onProgress?.({ stage: 'done', filename: file.name, message: 'Ready' });

    // Fetch the full document record
    return await getDocument(result.id);
  } catch (e) {
    console.error('Upload error:', e);
    onProgress?.({ stage: 'error', filename: file.name, message: String(e) });
    return null;
  }
}

/**
 * Get a single document by ID.
 */
export async function getDocument(id: string): Promise<DocumentRecord | null> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return data as unknown as DocumentRecord;
}

/**
 * List all documents.
 */
export async function listDocuments(): Promise<DocumentRecord[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data as unknown as DocumentRecord[];
}

/**
 * Get the primary dataset from a document (the main sheet for XLSX, all data for CSV).
 */
export function extractDataset(doc: DocumentRecord): { columns: string[]; rows: string[][] } | null {
  const sd = doc.structured_data as { sheets?: Record<string, { headers: string[]; rows: string[][] }> };
  if (!sd?.sheets) return null;

  const primarySheet = (doc.metadata as { primarySheet?: string })?.primarySheet;
  const sheetNames = Object.keys(sd.sheets);
  const targetName = primarySheet && sd.sheets[primarySheet] ? primarySheet : sheetNames[0];

  if (!targetName || !sd.sheets[targetName]) return null;

  const sheet = sd.sheets[targetName];
  return { columns: sheet.headers, rows: sheet.rows };
}

/**
 * Delete a document.
 */
export async function deleteDocument(id: string): Promise<boolean> {
  const doc = await getDocument(id);
  if (!doc) return false;

  // Delete from storage
  await supabase.storage.from('documents').remove([doc.storage_path]);

  // Delete from DB
  const { error } = await supabase.from('documents').delete().eq('id', id);
  return !error;
}
