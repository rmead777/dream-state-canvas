/**
 * Shader background settings — tunable at runtime from the admin panel.
 * Follows the same localStorage-backed pattern as admin-settings.ts.
 *
 * All slider values are normalized 0..1. The shader maps them to
 * appropriate GLSL ranges via lerp in the render loop.
 */

export interface ShaderSettings {
  // Color
  hue: number;
  saturation: number;
  brightness: number;
  // Motion
  speed: number;
  intensity: number;
  diffusion: number;
  // Effect
  emission: number;
  mouseReactivity: number;
  decay: number;
}

export const DEFAULT_SHADER_SETTINGS: ShaderSettings = {
  hue: 0.5,
  saturation: 0.65,
  brightness: 0.5,
  speed: 0.5,
  intensity: 0.5,
  diffusion: 0.5,
  emission: 0.5,
  mouseReactivity: 0.5,
  decay: 0.5,
};

const STORAGE_KEY = 'shader-settings';
const PRESETS_KEY = 'shader-presets';

let _settings: ShaderSettings = { ...DEFAULT_SHADER_SETTINGS };

// Load from localStorage on init
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    _settings = { ...DEFAULT_SHADER_SETTINGS, ...JSON.parse(stored) };
  }
} catch (e) { console.warn('[shader-settings] Failed to load:', e); }

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_settings));
  } catch (e) { console.warn('[shader-settings] Failed to persist:', e); }
}

/** Returns current settings. Called every frame by the shader — keep cheap. */
export function getShaderSettings(): ShaderSettings {
  return _settings;
}

export function setShaderParam(key: keyof ShaderSettings, value: number): void {
  _settings[key] = Math.max(0, Math.min(1, value));
  persist();
}

export function resetShaderSettings(): void {
  _settings = { ...DEFAULT_SHADER_SETTINGS };
  persist();
}

// ─── Presets ──────────────────────────────────────────────────────────────────

export interface ShaderPreset {
  name: string;
  settings: ShaderSettings;
  builtIn?: boolean;
}

const BUILT_IN_PRESETS: ShaderPreset[] = [
  { name: 'Default', settings: { ...DEFAULT_SHADER_SETTINGS }, builtIn: true },
  {
    name: 'Deep Ocean',
    builtIn: true,
    settings: {
      hue: 0.62, saturation: 0.8, brightness: 0.35,
      speed: 0.3, intensity: 0.65, diffusion: 0.7,
      emission: 0.4, mouseReactivity: 0.6, decay: 0.3,
    },
  },
  {
    name: 'Warm Nebula',
    builtIn: true,
    settings: {
      hue: 0.08, saturation: 0.55, brightness: 0.55,
      speed: 0.4, intensity: 0.55, diffusion: 0.45,
      emission: 0.7, mouseReactivity: 0.65, decay: 0.45,
    },
  },
  {
    name: 'Minimal',
    builtIn: true,
    settings: {
      hue: 0.5, saturation: 0.2, brightness: 0.6,
      speed: 0.2, intensity: 0.25, diffusion: 0.3,
      emission: 0.15, mouseReactivity: 0.2, decay: 0.7,
    },
  },
  {
    name: 'Aurora',
    builtIn: true,
    settings: {
      hue: 0.38, saturation: 0.75, brightness: 0.45,
      speed: 0.55, intensity: 0.7, diffusion: 0.6,
      emission: 0.8, mouseReactivity: 0.7, decay: 0.35,
    },
  },
];

function loadUserPresets(): ShaderPreset[] {
  try {
    const stored = localStorage.getItem(PRESETS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function persistUserPresets(presets: ShaderPreset[]) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch (e) { console.warn('[shader-settings] Failed to persist presets:', e); }
}

export function getShaderPresets(): ShaderPreset[] {
  return [...BUILT_IN_PRESETS, ...loadUserPresets()];
}

export function saveShaderPreset(name: string): void {
  const userPresets = loadUserPresets().filter(p => p.name !== name);
  userPresets.push({ name, settings: { ..._settings } });
  persistUserPresets(userPresets);
}

export function deleteShaderPreset(name: string): void {
  persistUserPresets(loadUserPresets().filter(p => p.name !== name));
}

export function loadShaderPreset(preset: ShaderPreset): void {
  _settings = { ...preset.settings };
  persist();
}
