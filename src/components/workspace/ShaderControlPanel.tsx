/**
 * ShaderControlPanel — admin panel for tuning the WebGL background shader.
 * 9 grouped sliders (Color, Motion, Effect) + presets + reset.
 */

import { useState } from 'react';
import {
  getShaderSettings,
  setShaderParam,
  resetShaderSettings,
  getShaderPresets,
  saveShaderPreset,
  deleteShaderPreset,
  loadShaderPreset,
  DEFAULT_SHADER_SETTINGS,
  type ShaderSettings,
} from '@/lib/shader-settings';
import { toast } from 'sonner';

interface SliderDef {
  key: keyof ShaderSettings;
  label: string;
  icon: string;
}

const GROUPS: { title: string; sliders: SliderDef[] }[] = [
  {
    title: 'Color',
    sliders: [
      { key: 'hue', label: 'Hue Shift', icon: 'H' },
      { key: 'saturation', label: 'Saturation', icon: 'S' },
      { key: 'brightness', label: 'Brightness', icon: 'B' },
    ],
  },
  {
    title: 'Motion',
    sliders: [
      { key: 'speed', label: 'Speed', icon: 'v' },
      { key: 'intensity', label: 'Intensity', icon: 'I' },
      { key: 'diffusion', label: 'Diffusion', icon: 'D' },
    ],
  },
  {
    title: 'Effect',
    sliders: [
      { key: 'emission', label: 'Emission', icon: 'E' },
      { key: 'mouseReactivity', label: 'Mouse Bloom', icon: 'M' },
      { key: 'decay', label: 'Trail Decay', icon: 'T' },
    ],
  },
  {
    title: 'Shape',
    sliders: [
      { key: 'scale', label: 'Zoom / Scale', icon: 'Z' },
      { key: 'turbulence', label: 'Turbulence', icon: 'W' },
      { key: 'coverage', label: 'Coverage', icon: 'C' },
      { key: 'vividness', label: 'Vividness', icon: 'V' },
      { key: 'bloomRadius', label: 'Bloom Radius', icon: 'R' },
    ],
  },
];

export function ShaderControlPanel() {
  const [settings, setSettings] = useState<ShaderSettings>(getShaderSettings);
  const [presetName, setPresetName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);

  const handleChange = (key: keyof ShaderSettings, value: number) => {
    setShaderParam(key, value);
    setSettings({ ...getShaderSettings() });
  };

  const handleReset = () => {
    resetShaderSettings();
    setSettings({ ...getShaderSettings() });
    toast.success('Shader reset to defaults');
  };

  const handleLoadPreset = (preset: ReturnType<typeof getShaderPresets>[0]) => {
    loadShaderPreset(preset);
    setSettings({ ...getShaderSettings() });
    toast.success(`Loaded "${preset.name}"`);
  };

  const handleSavePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    saveShaderPreset(name);
    setPresetName('');
    setShowSaveInput(false);
    toast.success(`Saved preset "${name}"`);
  };

  const handleDeletePreset = (name: string) => {
    deleteShaderPreset(name);
    toast.success(`Deleted "${name}"`);
  };

  const presets = getShaderPresets();
  const isDefault = Object.keys(DEFAULT_SHADER_SETTINGS).every(
    (k) => Math.abs(settings[k as keyof ShaderSettings] - DEFAULT_SHADER_SETTINGS[k as keyof ShaderSettings]) < 0.005
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/75">
            Background Shader
          </span>
        </div>
        {!isDefault && (
          <button
            onClick={handleReset}
            className="text-[9px] uppercase tracking-wider text-workspace-text-secondary/50 hover:text-workspace-accent transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      {/* Presets */}
      <div>
        <label className="block text-[10px] text-workspace-text-secondary/60 mb-1.5">Presets</label>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <div key={preset.name} className="group relative">
              <button
                onClick={() => handleLoadPreset(preset)}
                className="rounded-md border border-workspace-border/40 bg-workspace-surface/20 px-2.5 py-1 text-[10px] text-workspace-text-secondary hover:border-workspace-accent/30 hover:text-workspace-text transition-all"
              >
                {preset.name}
              </button>
              {!preset.builtIn && (
                <button
                  onClick={() => handleDeletePreset(preset.name)}
                  className="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-red-500/80 text-white text-[8px] leading-none"
                  title="Delete preset"
                >
                  x
                </button>
              )}
            </div>
          ))}
          {!showSaveInput ? (
            <button
              onClick={() => setShowSaveInput(true)}
              className="rounded-md border border-dashed border-workspace-border/40 px-2.5 py-1 text-[10px] text-workspace-text-secondary/40 hover:border-workspace-accent/30 hover:text-workspace-text-secondary transition-all"
            >
              + Save
            </button>
          ) : (
            <form
              onSubmit={(e) => { e.preventDefault(); handleSavePreset(); }}
              className="flex items-center gap-1"
            >
              <input
                autoFocus
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Name..."
                className="w-20 rounded-md border border-workspace-accent/30 bg-workspace-surface/30 px-2 py-1 text-[10px] text-workspace-text outline-none placeholder:text-workspace-text-secondary/30"
                onBlur={() => { if (!presetName.trim()) setShowSaveInput(false); }}
              />
              <button
                type="submit"
                className="rounded-md bg-workspace-accent/20 px-2 py-1 text-[10px] text-workspace-accent hover:bg-workspace-accent/30 transition-colors"
              >
                Save
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Slider groups */}
      {GROUPS.map((group) => (
        <div key={group.title}>
          <div className="text-[9px] uppercase tracking-wider text-workspace-text-secondary/40 font-medium mb-2">
            {group.title}
          </div>
          <div className="space-y-2.5">
            {group.sliders.map(({ key, label, icon }) => (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <label className="flex items-center gap-1.5 text-[10px] text-workspace-text-secondary/60">
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-workspace-surface/40 text-[8px] font-mono text-workspace-text-secondary/40">
                      {icon}
                    </span>
                    {label}
                  </label>
                  <span className="text-[9px] font-mono text-workspace-accent/60 tabular-nums">
                    {settings[key].toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={settings[key]}
                  onChange={(e) => handleChange(key, Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-workspace-border/40 accent-workspace-accent cursor-pointer"
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
