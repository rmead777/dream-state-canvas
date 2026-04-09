import { useState, useCallback } from 'react';
import { useDocuments } from '@/contexts/DocumentContext';
import { X, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { getIngestSettings, MODEL_OPTIONS } from '@/lib/ingest-settings';

export type ContextMode = 'auto' | 'manual';

interface DocumentContextSelectorProps {
  selectedDocIds: string[];
  onSelectionChange: (ids: string[]) => void;
  contextMode: ContextMode;
  onModeChange: (mode: ContextMode) => void;
  onOpenDocument?: (doc: { id: string; filename: string; file_type: string; structured_data: any }) => void;
}

const FILE_TYPE_ICONS: Record<string, string> = {
  xlsx: '📊',
  csv: '📋',
  pdf: '📄',
  docx: '📝',
  txt: '📃',
  md: '📃',
  image: '🖼️',
};

export function DocumentContextSelector({
  selectedDocIds,
  onSelectionChange,
  contextMode,
  onModeChange,
  onOpenDocument,
}: DocumentContextSelectorProps) {
  const { documents, removeDocument, reingestDocument } = useDocuments();
  const [isExpanded, setIsExpanded] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [reingestingId, setReingestingId] = useState<string | null>(null);

  const toggleDoc = useCallback(
    (docId: string) => {
      if (selectedDocIds.includes(docId)) {
        onSelectionChange(selectedDocIds.filter((id) => id !== docId));
      } else {
        onSelectionChange([...selectedDocIds, docId]);
      }
      // Switch to manual when user explicitly toggles
      if (contextMode === 'auto') {
        onModeChange('manual');
      }
    },
    [selectedDocIds, onSelectionChange, contextMode, onModeChange]
  );

  const selectAll = useCallback(() => {
    onSelectionChange(documents.map((d) => d.id));
    onModeChange('manual');
  }, [documents, onSelectionChange, onModeChange]);

  const selectNone = useCallback(() => {
    onSelectionChange([]);
    onModeChange('manual');
  }, [onSelectionChange, onModeChange]);

  const handleDelete = useCallback(async (docId: string) => {
    setDeletingId(docId);
    await removeDocument(docId);
    onSelectionChange(selectedDocIds.filter((id) => id !== docId));
    setDeletingId(null);
    setConfirmId(null);
  }, [removeDocument, selectedDocIds, onSelectionChange]);

  const handleReingest = useCallback(async (docId: string, filename: string) => {
    const settings = getIngestSettings();
    const modelOption = MODEL_OPTIONS.find((m) => m.id === settings.model);
    const modelLabel = modelOption?.label || settings.model;

    setReingestingId(docId);
    toast.info(`Re-ingesting "${filename}" with ${modelLabel}...`);

    const ok = await reingestDocument(docId);
    setReingestingId(null);

    if (ok) {
      // The doc ID changed — drop the old one from selection
      onSelectionChange(selectedDocIds.filter((id) => id !== docId));
      toast.success(`"${filename}" re-ingested with ${modelLabel}`);
    } else {
      toast.error(`Failed to re-ingest "${filename}"`);
    }
  }, [reingestDocument, selectedDocIds, onSelectionChange]);

  if (documents.length === 0) return null;

  const selectedCount =
    contextMode === 'auto' ? documents.length : selectedDocIds.length;

  return (
    <div className="border-b border-workspace-border/30 mb-3">
      {/* Header row — always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between py-1.5 text-left group"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-workspace-text-secondary/50 transition-transform duration-200"
            style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            ▶
          </span>
          <span className="text-[9px] uppercase tracking-widest text-workspace-text-secondary/40">
            Context
          </span>
          <span className="text-[9px] text-workspace-accent/50">
            {contextMode === 'auto' ? 'Auto' : `${selectedCount}/${documents.length}`}
          </span>
        </div>
        <span className="text-[8px] text-workspace-text-secondary/30 opacity-0 group-hover:opacity-100 transition-opacity">
          {isExpanded ? 'collapse' : 'expand'}
        </span>
      </button>

      {/* Expanded panel */}
      {isExpanded && (
        <div className="pb-3 animate-[materialize_0.2s_cubic-bezier(0.16,1,0.3,1)_forwards]">
          {/* Mode toggle */}
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => onModeChange('auto')}
              className={`rounded px-2 py-0.5 text-[9px] transition-colors ${
                contextMode === 'auto'
                  ? 'bg-workspace-accent/10 text-workspace-accent border border-workspace-accent/20'
                  : 'text-workspace-text-secondary/50 hover:text-workspace-text-secondary border border-transparent'
              }`}
            >
              Smart auto
            </button>
            <button
              onClick={() => onModeChange('manual')}
              className={`rounded px-2 py-0.5 text-[9px] transition-colors ${
                contextMode === 'manual'
                  ? 'bg-workspace-accent/10 text-workspace-accent border border-workspace-accent/20'
                  : 'text-workspace-text-secondary/50 hover:text-workspace-text-secondary border border-transparent'
              }`}
            >
              Manual
            </button>
            {contextMode === 'manual' && (
              <div className="flex items-center gap-1 ml-auto">
                <button onClick={selectAll} className="text-[8px] text-workspace-accent/50 hover:text-workspace-accent">
                  All
                </button>
                <span className="text-[8px] text-workspace-text-secondary/20">|</span>
                <button onClick={selectNone} className="text-[8px] text-workspace-accent/50 hover:text-workspace-accent">
                  None
                </button>
              </div>
            )}
          </div>

          {/* Document list */}
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {documents.map((doc) => {
              const isSelected =
                contextMode === 'auto' || selectedDocIds.includes(doc.id);
              const isConfirming = confirmId === doc.id;
              const isDeleting = deletingId === doc.id;
              return (
                <div
                  key={doc.id}
                  className={`flex items-center gap-2 rounded px-2 py-1 group transition-colors ${
                    isSelected
                      ? 'bg-workspace-accent/5'
                      : 'hover:bg-workspace-surface/50 opacity-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleDoc(doc.id)}
                    disabled={contextMode === 'auto'}
                    className="h-3 w-3 rounded border-workspace-border text-workspace-accent focus:ring-workspace-accent/20 disabled:opacity-30 shrink-0"
                  />
                  <button
                    onClick={() => onOpenDocument?.(doc as any)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left hover:text-workspace-accent transition-colors"
                    title="Open in viewer"
                  >
                    <span className="text-[10px] shrink-0">
                      {(doc.metadata as any)?.isScratchpad ? '🧠' : (FILE_TYPE_ICONS[doc.file_type] || '📁')}
                    </span>
                    <span className="text-[10px] text-inherit truncate flex-1">
                      {doc.filename}
                    </span>
                  </button>
                  {(doc.metadata as any)?.isScratchpad && (
                    <span className="text-[7px] font-medium uppercase tracking-wider text-purple-500 bg-purple-50 px-1 py-0.5 rounded shrink-0">
                      AI Scratchpad
                    </span>
                  )}
                  <span className="text-[8px] text-workspace-text-secondary/30 uppercase shrink-0">
                    {(doc.metadata as any)?.isScratchpad ? '' : doc.file_type}
                  </span>
                  {isConfirming ? (
                    <button
                      onClick={() => handleDelete(doc.id)}
                      disabled={isDeleting}
                      className="text-[8px] text-red-400 hover:text-red-300 shrink-0 transition-colors"
                    >
                      {isDeleting ? '...' : 'confirm?'}
                    </button>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (reingestingId) return;
                          handleReingest(doc.id, doc.filename);
                        }}
                        disabled={reingestingId === doc.id}
                        className="opacity-0 group-hover:opacity-100 text-workspace-text-secondary/30 hover:text-workspace-accent transition-all disabled:opacity-100 disabled:text-workspace-accent"
                        title="Re-ingest with current model"
                      >
                        <RefreshCw className={`h-3 w-3 ${reingestingId === doc.id ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmId(doc.id); }}
                        className="opacity-0 group-hover:opacity-100 text-workspace-text-secondary/30 hover:text-red-400 transition-all"
                        title="Remove document"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {contextMode === 'auto' && (
            <p className="text-[8px] text-workspace-text-secondary/30 mt-1.5 px-1">
              AI automatically selects relevant documents per query
            </p>
          )}
        </div>
      )}
    </div>
  );
}
