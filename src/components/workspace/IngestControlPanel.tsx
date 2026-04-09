/**
 * IngestControlPanel — admin panel for document ingestion settings.
 * Controls which AI model processes uploads, max output tokens, and
 * whether to bypass AI extraction for plain-text files.
 *
 * Same visual pattern as ThreeDControlPanel / ShaderControlPanel.
 */

import { useState } from 'react';
import {
  getIngestSettings,
  setIngestModel,
  setIngestMaxTokens,
  setIngestBypassAiForText,
  resetIngestSettings,
  DEFAULT_INGEST_SETTINGS,
  MODEL_OPTIONS,
  type IngestSettings,
} from '@/lib/ingest-settings';
import { toast } from 'sonner';

export function IngestControlPanel() {
  const [settings, setSettings] = useState<IngestSettings>(getIngestSettings);

  const handleModelChange = (modelId: string) => {
    setIngestModel(modelId);
    setSettings({ ...getIngestSettings() });
    const option = MODEL_OPTIONS.find((m) => m.id === modelId);
    toast.success(`Document model: ${option?.label || modelId}`);
  };

  const handleMaxTokensChange = (value: number) => {
    setIngestMaxTokens(value);
    setSettings({ ...getIngestSettings() });
  };

  const handleBypassToggle = () => {
    setIngestBypassAiForText(!settings.bypassAiForText);
    setSettings({ ...getIngestSettings() });
  };

  const handleReset = () => {
    resetIngestSettings();
    setSettings({ ...getIngestSettings() });
    toast.success('Ingestion settings reset to defaults');
  };

  const isDefault =
    settings.model === DEFAULT_INGEST_SETTINGS.model &&
    settings.maxTokens === DEFAULT_INGEST_SETTINGS.maxTokens &&
    settings.bypassAiForText === DEFAULT_INGEST_SETTINGS.bypassAiForText;

  const currentOption = MODEL_OPTIONS.find((m) => m.id === settings.model);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/75">
            Document Ingestion
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

      {/* Model selector */}
      <div>
        <label className="block text-[10px] text-workspace-text-secondary/60 mb-1.5">
          Extraction Model
        </label>
        <div className="space-y-1.5">
          {MODEL_OPTIONS.map((option) => {
            const isActive = settings.model === option.id;
            return (
              <button
                key={option.id}
                onClick={() => handleModelChange(option.id)}
                className={`w-full text-left rounded-md border px-2.5 py-1.5 transition-all ${
                  isActive
                    ? 'border-workspace-accent/50 bg-workspace-accent/10'
                    : 'border-workspace-border/40 bg-workspace-surface/20 hover:border-workspace-accent/30'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[10px] font-medium ${
                      isActive ? 'text-workspace-accent' : 'text-workspace-text-secondary'
                    }`}
                  >
                    {option.label}
                  </span>
                  {option.supportsPdf && (
                    <span className="text-[8px] uppercase tracking-wider text-emerald-400/70 font-mono">
                      Native PDF
                    </span>
                  )}
                </div>
                <div className="text-[9px] text-workspace-text-secondary/50 mt-0.5 leading-tight">
                  {option.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Max tokens slider */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="flex items-center gap-1.5 text-[10px] text-workspace-text-secondary/60">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-workspace-surface/40 text-[8px] font-mono text-workspace-text-secondary/40">
              T
            </span>
            Max Output Tokens
          </label>
          <span className="text-[9px] font-mono text-workspace-accent/60 tabular-nums">
            {(settings.maxTokens / 1000).toFixed(0)}K
          </span>
        </div>
        <input
          type="range"
          min={4000}
          max={64000}
          step={1000}
          value={settings.maxTokens}
          onChange={(e) => handleMaxTokensChange(Number(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none bg-workspace-border/40 accent-workspace-accent cursor-pointer"
        />
        <div className="flex justify-between text-[8px] text-workspace-text-secondary/30 mt-0.5">
          <span>4K</span>
          <span>32K</span>
          <span>64K</span>
        </div>
      </div>

      {/* Bypass AI for text toggle */}
      <div>
        <button
          onClick={handleBypassToggle}
          className="w-full flex items-center justify-between rounded-md border border-workspace-border/40 bg-workspace-surface/20 px-2.5 py-2 hover:border-workspace-accent/30 transition-all"
        >
          <div className="flex flex-col items-start">
            <span className="text-[10px] font-medium text-workspace-text-secondary">
              Bypass AI for text files
            </span>
            <span className="text-[9px] text-workspace-text-secondary/40 mt-0.5 leading-tight text-left">
              .txt/.md/.docx use raw content + lightweight summary
            </span>
          </div>
          <div
            className={`relative inline-block h-4 w-7 rounded-full transition-colors ${
              settings.bypassAiForText ? 'bg-workspace-accent/70' : 'bg-workspace-border/60'
            }`}
          >
            <div
              className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
                settings.bypassAiForText ? 'left-[14px]' : 'left-0.5'
              }`}
            />
          </div>
        </button>
      </div>

      {/* Active model summary */}
      {currentOption && (
        <div className="rounded-md border border-workspace-border/30 bg-workspace-surface/10 px-2.5 py-2">
          <div className="text-[9px] uppercase tracking-wider text-workspace-text-secondary/40 mb-1">
            Active
          </div>
          <div className="text-[10px] font-mono text-workspace-text-secondary">
            {currentOption.label}
          </div>
          <div className="text-[9px] text-workspace-text-secondary/40 mt-0.5">
            {(settings.maxTokens / 1000).toFixed(0)}K output •{' '}
            {settings.bypassAiForText ? 'text bypass ON' : 'text bypass OFF'}
          </div>
        </div>
      )}
    </div>
  );
}
