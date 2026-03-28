/**
 * Admin mode settings — unlocked via passphrase in Sherpa.
 * Controls AI model selection and max token output.
 */

export interface AdminSettings {
  isUnlocked: boolean;
  model: string;
  maxTokens: number;
}

const PASSPHRASE = 'protocol alpha';
const STORAGE_KEY = 'admin-settings';

const AVAILABLE_MODELS = [
  { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash', description: 'Fast & balanced (default)' },
  { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', description: 'Maximum reasoning depth' },
  { id: 'google/gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite', description: 'Fastest, lowest cost' },
] as const;

export { AVAILABLE_MODELS };

const DEFAULT_SETTINGS: AdminSettings = {
  isUnlocked: false,
  model: 'google/gemini-3-flash-preview',
  maxTokens: 8192,
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
