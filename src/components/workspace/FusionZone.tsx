import { useState } from 'react';

interface FusionZoneProps {
  sourceTitle: string;
  targetTitle: string;
  onFuse: () => void;
  onCancel: () => void;
  isProcessing: boolean;
}

export function FusionZone({ sourceTitle, targetTitle, onFuse, onCancel, isProcessing }: FusionZoneProps) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-workspace-text/5 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative animate-[materialize_0.3s_cubic-bezier(0.16,1,0.3,1)_forwards] rounded-2xl border border-workspace-accent/20 bg-white shadow-[0_16px_64px_rgba(0,0,0,0.1)] p-8 max-w-md text-center">
        {/* Fusion visualization */}
        <div className="flex items-center justify-center gap-4 mb-6">
          <div className="rounded-xl border border-workspace-border px-4 py-3 text-sm text-workspace-text bg-workspace-surface/50">
            {sourceTitle}
          </div>
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-workspace-accent/10 flex items-center justify-center">
              <span className="text-workspace-accent text-sm">✦</span>
            </div>
            {isProcessing && (
              <div className="absolute inset-0 rounded-full border-2 border-workspace-accent/30 border-t-workspace-accent animate-spin" />
            )}
          </div>
          <div className="rounded-xl border border-workspace-border px-4 py-3 text-sm text-workspace-text bg-workspace-surface/50">
            {targetTitle}
          </div>
        </div>

        <p className="text-sm text-workspace-text mb-1">Synthesize these objects?</p>
        <p className="text-xs text-workspace-text-secondary mb-6">
          AI will analyze both and create a new insight object
        </p>

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={onCancel}
            className="rounded-lg border border-workspace-border px-4 py-2 text-xs text-workspace-text-secondary transition-colors hover:bg-workspace-surface"
          >
            Cancel
          </button>
          <button
            onClick={onFuse}
            disabled={isProcessing}
            className="rounded-lg bg-workspace-accent/10 px-4 py-2 text-xs text-workspace-accent transition-colors hover:bg-workspace-accent/20 disabled:opacity-50"
          >
            {isProcessing ? 'Synthesizing...' : '✦ Fuse'}
          </button>
        </div>
      </div>
    </div>
  );
}
