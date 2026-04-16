/**
 * Admin mode settings — unlocked via passphrase in Sherpa.
 * Controls AI model selection and max token output.
 */

export interface AdminSettings {
  isUnlocked: boolean;
  model: string;
  maxTokens: number;
  /** Number of previous conversation turns to include in AI context */
  contextWindow: number;
  /** Max tool-calling iterations in the agent loop */
  agentMaxIterations: number;
}

const PASSPHRASE = 'protocol alpha';
const STORAGE_KEY = 'admin-settings';

export type AIProvider = 'google' | 'anthropic' | 'openai' | 'xai';

export interface ModelDef {
  id: string;
  label: string;
  description: string;
  provider: AIProvider;
}

const AVAILABLE_MODELS: ModelDef[] = [
  // Google — default provider (routed through Lovable gateway)
  { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash', description: 'Fast & balanced (default)', provider: 'google' },
  { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', description: 'Maximum reasoning depth', provider: 'google' },
  { id: 'google/gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite', description: 'Fastest, lowest cost', provider: 'google' },

  // Anthropic
  { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Balanced speed & intelligence', provider: 'anthropic' },
  { id: 'anthropic/claude-opus-4-7', label: 'Claude Opus 4.7', description: 'Maximum reasoning depth', provider: 'anthropic' },
  { id: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5', description: 'Fastest Anthropic model', provider: 'anthropic' },

  // xAI (Grok)
  { id: 'xai/grok-4-1-fast', label: 'Grok 4.1 Fast', description: 'Fast general-purpose', provider: 'xai' },
  { id: 'xai/grok-4.20-beta', label: 'Grok 4.20', description: 'Latest Grok flagship', provider: 'xai' },
  { id: 'xai/grok-4.20-multi-agent-beta-latest', label: 'Grok 4.20 Multi-Agent', description: 'Multi-agent orchestration', provider: 'xai' },

  // OpenAI
  { id: 'openai/gpt-5.4-2026-03-05', label: 'GPT-5.4', description: 'Latest OpenAI flagship', provider: 'openai' },
  { id: 'openai/gpt-5.4-mini-2026-03-17', label: 'GPT-5.4 Mini', description: 'Fast & efficient OpenAI', provider: 'openai' },
];

export { AVAILABLE_MODELS };

const DEFAULT_SETTINGS: AdminSettings = {
  isUnlocked: false,
  model: 'google/gemini-3-flash-preview',
  maxTokens: 16192,
  contextWindow: 10,
  agentMaxIterations: 8,
};

let _settings: AdminSettings = { ...DEFAULT_SETTINGS };

// Load from localStorage on init
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    _settings = { ...DEFAULT_SETTINGS, ...parsed };
  }
} catch (e) { console.warn('[admin-settings] Failed to load from localStorage:', e); }

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_settings));
  } catch (e) { console.warn('[admin-settings] Failed to persist:', e); }
}

export function getAdminSettings(): AdminSettings {
  return { ..._settings };
}

export function isAdminUnlocked(): boolean {
  return _settings.isUnlocked;
}

export function checkPassphrase(input: string): boolean {
  return input.trim().toLowerCase() === PASSPHRASE;
}

export function unlockAdmin(): void {
  _settings.isUnlocked = true;
  persist();
}

export function lockAdmin(): void {
  _settings = { ...DEFAULT_SETTINGS };
  persist();
}

export function setAdminModel(model: string): void {
  _settings.model = model;
  persist();
}

export function setAdminMaxTokens(maxTokens: number): void {
  _settings.maxTokens = Math.max(256, Math.min(32768, maxTokens));
  persist();
}

export function setAdminContextWindow(n: number): void {
  _settings.contextWindow = Math.max(1, Math.min(50, n));
  persist();
}
