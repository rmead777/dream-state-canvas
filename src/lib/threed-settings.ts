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

  // Environment
  fogDensity: number;    // fog near/far range
  groundOpacity: number; // ground plane opacity
  envIntensity: number;  // environment map intensity

  // Overlays
  labelThreshold: number; // min ratio to show value labels (0..1)
  entranceSpeed: number;  // entrance animation speed
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
  fogDensity: 0.5,
  groundOpacity: 0.5,
  envIntensity: 0.3,
  labelThreshold: 0.3,
  entranceSpeed: 0.5,
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
    // Environment
    fogNear: lerp(6, 18, s.fogDensity),
    fogFar: lerp(15, 35, s.fogDensity),
    groundOpacity: lerp(0.1, 0.8, s.groundOpacity),
    envIntensity: lerp(0.05, 0.4, s.envIntensity),
    // Overlays
    labelThreshold: lerp(0.05, 0.5, s.labelThreshold),
    entranceMaxDelay: lerp(0.5, 2.5, s.entranceSpeed),
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
      fogDensity: 0.4, groundOpacity: 0.5, envIntensity: 0.3,
      labelThreshold: 0.2, entranceSpeed: 0.6,
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
      fogDensity: 0.7, groundOpacity: 0.3, envIntensity: 0.2,
      labelThreshold: 0.4, entranceSpeed: 0.3,
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
      fogDensity: 0.3, groundOpacity: 0.6, envIntensity: 0.4,
      labelThreshold: 0.15, entranceSpeed: 0.7,
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
  _settings = { ...DEFAULT_3D_SETTINGS, ...preset.settings };
  persist();
}
