/**
 * Document ingestion settings — tunable at runtime from the admin panel.
 * Follows the same localStorage-backed pattern as threed-settings.ts.
 *
 * Controls which AI model processes uploaded documents (PDF/image/text),
 * the max output tokens for extraction, and whether to bypass AI entirely
 * for plain-text files (recommended — saves tokens and avoids truncation).
 */

export interface IngestSettings {
  model: string;           // e.g. 'anthropic/claude-sonnet-4-6'
  maxTokens: number;       // max output tokens for extraction (4K–64K)
  bypassAiForText: boolean; // skip AI extraction for .txt/.md/.docx (use raw content)
}

/**
 * Built-in model options for the dropdown.
 * Ordered by recommendation for document ingestion.
 */
export interface ModelOption {
  id: string;
  label: string;
  description: string;
  supportsPdf: boolean; // native PDF support (vs vision-based)
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'anthropic/claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    description: 'Best balance — deep reasoning, native PDF, $0 on subscription',
    supportsPdf: true,
  },
  {
    id: 'anthropic/claude-opus-4-6',
    label: 'Claude Opus 4.6',
    description: 'Maximum accuracy for critical docs — slower, worth it for IC memos',
    supportsPdf: true,
  },
  {
    id: 'anthropic/claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5',
    description: 'Fastest Anthropic option — 200K context, great for routine uploads',
    supportsPdf: true,
  },
  {
    id: 'google/gemini-3-flash-preview',
    label: 'Gemini 3 Flash',
    description: 'Previous default — fast but 8K output cap on long docs',
    supportsPdf: false,
  },
  {
    id: 'google/gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    description: 'Large context, good for very long non-PDF documents',
    supportsPdf: false,
  },
];

export const DEFAULT_INGEST_SETTINGS: IngestSettings = {
  model: 'anthropic/claude-sonnet-4-6',
  maxTokens: 64000,
  bypassAiForText: true,
};

const STORAGE_KEY = 'ingest-settings';

let _settings: IngestSettings = { ...DEFAULT_INGEST_SETTINGS };

// Load from localStorage on init (merge with defaults for forward-compat)
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    _settings = { ...DEFAULT_INGEST_SETTINGS, ...JSON.parse(stored) };
  }
} catch (e) {
  console.warn('[ingest-settings] Failed to load:', e);
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_settings));
  } catch (e) {
    console.warn('[ingest-settings] Failed to persist:', e);
  }
}

/** Returns current settings. Called on every document upload. */
export function getIngestSettings(): IngestSettings {
  return _settings;
}

/** Set the ingestion model (e.g. 'anthropic/claude-sonnet-4-6'). */
export function setIngestModel(modelId: string): void {
  _settings.model = modelId;
  persist();
}

/** Set max output tokens (clamped to 4K–64K range). */
export function setIngestMaxTokens(value: number): void {
  _settings.maxTokens = Math.max(4000, Math.min(64000, Math.round(value)));
  persist();
}

/** Toggle AI bypass for plain text files. */
export function setIngestBypassAiForText(value: boolean): void {
  _settings.bypassAiForText = value;
  persist();
}

/** Reset to factory defaults. */
export function resetIngestSettings(): void {
  _settings = { ...DEFAULT_INGEST_SETTINGS };
  persist();
}

/** Look up a model option by ID, or return null if unknown (custom model ID). */
export function getModelOption(modelId: string): ModelOption | null {
  return MODEL_OPTIONS.find((m) => m.id === modelId) || null;
}
