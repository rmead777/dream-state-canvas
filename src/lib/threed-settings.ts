/**
 * 3D scene settings — tunable at runtime from the admin panel.
 * Follows the same localStorage-backed pattern as shader-settings.ts.
 *
 * All slider values are normalized 0..1. ThreeDRenderer maps them
 * to appropriate ranges in the render loop.
 */

export interface ThreeDSettings {
  // Particles
  density: number;       // particle count multiplier (maps to 10–80)
  size: number;          // base particle radius
  speed: number;         // base flow speed

  // Scale (how values differentiate)
  valueExponent: number; // how aggressively size scales with value
  speedRange: number;    // min/max speed ratio spread

  // Scene
  cameraDistance: number; // zoom level
  autoRotateSpeed: number;
  hubSize: number;       // destination sphere size

  // Material
  opacity: number;       // particle opacity
  trailSpread: number;   // z-axis spread of bezier control points
}

export const DEFAULT_3D_SETTINGS: ThreeDSettings = {
  density: 0.5,
  size: 0.5,
  speed: 0.5,
  valueExponent: 0.5,
  speedRange: 0.5,
  cameraDistance: 0.5,
  autoRotateSpeed: 0.4,
  hubSize: 0.5,
  opacity: 0.5,
  trailSpread: 0.5,
};

const STORAGE_KEY = 'threed-settings';
const PRESETS_KEY = 'threed-presets';

let _settings: ThreeDSettings = { ...DEFAULT_3D_SETTINGS };

// Load from localStorage on init
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    _settings = { ...DEFAULT_3D_SETTINGS, ...JSON.parse(stored) };
  }
} catch (e) { console.warn('[threed-settings] Failed to load:', e); }

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_settings));
  } catch (e) { console.warn('[threed-settings] Failed to persist:', e); }
}

/** Returns current settings. Called every frame by the renderer — keep cheap. */
export function get3DSettings(): ThreeDSettings {
  return _settings;
}

export function set3DParam(key: keyof ThreeDSettings, value: number): void {
  _settings[key] = Math.max(0, Math.min(1, value));
  persist();
}

export function reset3DSettings(): void {
  _settings = { ...DEFAULT_3D_SETTINGS };
  persist();
}

// ─── Mapping helpers (0..1 → useful ranges) ─────────────────────────────────

/** Maps normalized 0..1 to a useful range with lerp */
function lerp(min: number, max: number, t: number) { return min + (max - min) * t; }

export function mapped3D() {
  const s = _settings;
  return {
    particleDensity: Math.round(lerp(10, 80, s.density)),
    particleRadius: lerp(0.04, 0.14, s.size),
    flowSpeed: lerp(0.1, 0.6, s.speed),
    // Value exponent: 0.3 = nearly uniform, 2.0 = extreme differentiation
    valueExponent: lerp(0.3, 2.0, s.valueExponent),
    // Speed range: [minMultiplier, maxMultiplier]
    speedMin: lerp(0.8, 0.3, s.speedRange),   // higher spread = lower min
    speedMax: lerp(1.2, 1.8, s.speedRange),    // higher spread = higher max
    cameraDistance: lerp(6, 12, s.cameraDistance),
    autoRotateSpeed: lerp(0, 1.2, s.autoRotateSpeed),
    hubRadius: lerp(0.25, 0.8, s.hubSize),
    opacity: lerp(0.3, 0.9, s.opacity),
    trailSpread: lerp(0.5, 4.0, s.trailSpread),
  };
}

// ─── Presets ─────────────────────────────────────────────────────────────────

export interface ThreeDPreset {
  name: string;
  settings: ThreeDSettings;
  builtIn?: boolean;
}

const BUILT_IN_PRESETS: ThreeDPreset[] = [
  { name: 'Default', settings: { ...DEFAULT_3D_SETTINGS }, builtIn: true },
  {
    name: 'Dense Stream',
    builtIn: true,
    settings: {
      density: 0.85, size: 0.4, speed: 0.6,
      valueExponent: 0.7, speedRange: 0.7,
      cameraDistance: 0.4, autoRotateSpeed: 0.3,
      hubSize: 0.6, opacity: 0.6, trailSpread: 0.4,
    },
  },
  {
    name: 'Minimal',
    builtIn: true,
    settings: {
      density: 0.2, size: 0.6, speed: 0.3,
      valueExponent: 0.3, speedRange: 0.2,
      cameraDistance: 0.6, autoRotateSpeed: 0.2,
      hubSize: 0.4, opacity: 0.4, trailSpread: 0.3,
    },
  },
  {
    name: 'Dramatic',
    builtIn: true,
    settings: {
      density: 0.7, size: 0.7, speed: 0.7,
      valueExponent: 0.9, speedRange: 0.9,
      cameraDistance: 0.3, autoRotateSpeed: 0.5,
      hubSize: 0.7, opacity: 0.7, trailSpread: 0.7,
    },
  },
];

function loadUserPresets(): ThreeDPreset[] {
  try {
    const stored = localStorage.getItem(PRESETS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function persistUserPresets(presets: ThreeDPreset[]) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch (e) { console.warn('[threed-settings] Failed to persist presets:', e); }
}

export function get3DPresets(): ThreeDPreset[] {
  return [...BUILT_IN_PRESETS, ...loadUserPresets()];
}

export function save3DPreset(name: string): void {
  const userPresets = loadUserPresets().filter(p => p.name !== name);
  userPresets.push({ name, settings: { ..._settings } });
  persistUserPresets(userPresets);
}

export function delete3DPreset(name: string): void {
  persistUserPresets(loadUserPresets().filter(p => p.name !== name));
}

export function load3DPreset(preset: ThreeDPreset): void {
  _settings = { ...preset.settings };
  persist();
}
