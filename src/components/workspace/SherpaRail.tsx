import { useState, useRef, useCallback } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { useSherpa } from '@/contexts/SherpaContext';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { useAmbientAudio } from '@/hooks/useAmbientAudio';
import { useCognitiveMode } from '@/hooks/useCognitiveMode';
import { MODE_LABELS } from '@/lib/cognitive-modes';
import { VoiceIndicator } from './VoiceIndicator';
import { RulesEditor } from './RulesEditor';
import { DocumentUpload } from './DocumentUpload';
import { useDocuments } from '@/contexts/DocumentContext';
import { getDocument, extractDataset } from '@/lib/document-store';
import { setActiveDataset } from '@/lib/active-dataset';
import { invalidateProfileCache } from '@/lib/intent-engine';
import { clearProfileCache } from '@/lib/data-analyzer';
import { toast } from 'sonner';

export function SherpaRail() {
  const { state, dispatch } = useWorkspace();
  const { processIntent } = useWorkspaceActions();
  const { suggestions, observations, lastResponse, isProcessing } = useSherpa();
  const cognitiveMode = useCognitiveMode();
  const { play } = useAmbientAudio();
  const [input, setInput] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);
  const [showCanvasMenu, setShowCanvasMenu] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [promptHistory, setPromptHistory] = useState<Array<{ query: string; response: string | null; timestamp: number }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { addDocument } = useDocuments();

  const handleDocumentIngested = useCallback(async (docId: string) => {
    const doc = await getDocument(docId);
    if (!doc) return;
    addDocument(doc);

    // If it's a spreadsheet, set as active dataset
    if (doc.file_type === 'xlsx' || doc.file_type === 'csv') {
      const dataset = extractDataset(doc);
      if (dataset && dataset.rows.length > 0) {
        setActiveDataset({
          columns: dataset.columns,
          rows: dataset.rows,
          sourceLabel: doc.filename,
          sourceDocId: doc.id,
        });
        clearProfileCache();
        invalidateProfileCache();
        toast.success(`${doc.filename} is now the active dataset (${dataset.rows.length} rows)`);
      }
    }
  }, [addDocument]);

  const activeObjectCount = Object.values(state.objects).filter(o => o.status !== 'dissolved').length;

  // handleClearSherpa is now handleClearSherpaFull below

  const handleCollapseAll = useCallback(() => {
    dispatch({ type: 'COLLAPSE_ALL_OBJECTS' });
    setShowCanvasMenu(false);
    toast.success('All objects minimized');
  }, [dispatch]);

  const handleDissolveAll = useCallback(() => {
    dispatch({ type: 'DISSOLVE_ALL_OBJECTS' });
    setShowCanvasMenu(false);
    toast.success('Canvas cleared');
  }, [dispatch]);

  const trackAndProcess = useCallback((text: string) => {
    setPromptHistory(prev => [...prev, { query: text, response: null, timestamp: Date.now() }]);
    processIntent(text);
  }, [processIntent]);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    trackAndProcess(trimmed);
    setInput('');
  }, [input, trackAndProcess]);

  const handleVoiceResult = useCallback(
    (transcript: string) => {
      play('focus');
      trackAndProcess(transcript);
    },
    [trackAndProcess, play]
  );

  const handleVoiceInterim = useCallback((transcript: string) => {
    setInput(transcript);
  }, []);

  const voice = useVoiceInput({
    onResult: handleVoiceResult,
    onInterim: handleVoiceInterim,
  });

  const handleSuggestionClick = (query: string) => {
    trackAndProcess(query);
  };

  const handleClearSherpaFull = useCallback(() => {
    dispatch({ type: 'CLEAR_SHERPA' });
    setPromptHistory([]);
    toast.success('Conversation cleared');
  }, [dispatch]);

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="fixed right-4 top-4 z-50 rounded-full bg-white border border-workspace-border px-4 py-2
          text-xs text-workspace-accent shadow-sm transition-all hover:shadow-md"
      >
        ✦ Sherpa
      </button>
    );
  }

  return (
    <div className="flex h-full w-80 flex-shrink-0 flex-col border-l border-workspace-border/50 bg-white/80 backdrop-blur-sm lg:w-[340px]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-workspace-accent text-sm">✦</span>
          <span className="text-xs font-semibold uppercase tracking-widest text-workspace-text">
            Sherpa
          </span>
          {cognitiveMode !== 'neutral' && (
            <span className="rounded-full bg-workspace-accent/8 border border-workspace-accent/10 px-2 py-0.5 text-[8px] uppercase tracking-widest text-workspace-accent/60 animate-[materialize_0.4s_cubic-bezier(0.16,1,0.3,1)_forwards]">
              {MODE_LABELS[cognitiveMode]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Upload toggle */}
          <button
            onClick={() => setShowUpload(!showUpload)}
            className={`rounded-md p-1 transition-colors text-[10px] ${
              showUpload
                ? 'bg-workspace-accent/10 text-workspace-accent'
                : 'text-workspace-text-secondary/40 hover:bg-workspace-surface hover:text-workspace-text-secondary'
            }`}
            title={showUpload ? 'Hide upload' : 'Upload documents'}
          >
            ↑
          </button>
          {/* Rules toggle */}
          <button
            onClick={() => setShowRules(!showRules)}
            className={`rounded-md p-1 transition-colors text-[10px] ${
              showRules
                ? 'bg-workspace-accent/10 text-workspace-accent'
                : 'text-workspace-text-secondary/40 hover:bg-workspace-surface hover:text-workspace-text-secondary'
            }`}
            title={showRules ? 'Hide rules' : 'Data rules'}
          >
            ⚙
          </button>
          {promptHistory.length > 0 && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`rounded-md p-1 transition-colors text-[10px] ${
                showHistory
                  ? 'bg-workspace-accent/10 text-workspace-accent'
                  : 'text-workspace-text-secondary/40 hover:bg-workspace-surface hover:text-workspace-text-secondary'
              }`}
              title={showHistory ? 'Hide conversation' : 'Show conversation'}
            >
              ≡
            </button>
          )}
          {(lastResponse || observations.length > 0) && (
            <button
              onClick={handleClearSherpaFull}
              className="rounded-md p-1 text-workspace-text-secondary/40 transition-colors hover:bg-workspace-surface hover:text-workspace-text-secondary text-[10px]"
              title="Clear conversation"
            >
              ⌫
            </button>
          )}
          <button
            onClick={() => setIsExpanded(false)}
            className="rounded-md p-1 text-workspace-text-secondary transition-colors hover:bg-workspace-surface text-xs"
          >
            ▸
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5">
        {/* Rules editor panel */}
        {showRules && (
          <div className="pb-4 border-b border-workspace-border/30 mb-4">
            <RulesEditor onClose={() => setShowRules(false)} />
          </div>
        )}

        {/* Upload panel */}
        {showUpload && (
          <div className="pb-4 border-b border-workspace-border/30 mb-4">
            <span className="text-[9px] uppercase tracking-widest text-workspace-text-secondary/40 block mb-2">
              Upload Documents
            </span>
            <DocumentUpload onDocumentIngested={handleDocumentIngested} />
            <p className="text-[9px] text-workspace-text-secondary/40 mt-2">
              XLSX, CSV, PDF, DOCX, TXT, MD, Images
            </p>
          </div>
        )}

        {/* Conversation history (optional) */}
        {showHistory && promptHistory.length > 0 && (
          <div className="space-y-3 pb-4 border-b border-workspace-border/30 mb-4">
            <span className="text-[9px] uppercase tracking-widest text-workspace-text-secondary/40">
              History
            </span>
            {promptHistory.map((entry, i) => (
              <div key={entry.timestamp} className="space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="text-[9px] text-workspace-accent/50 mt-0.5 shrink-0">→</span>
                  <p className="text-[11px] text-workspace-text font-medium leading-relaxed">{entry.query}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Fusion processing animation */}
        {isProcessing && (
          <div className="flex items-center gap-3 rounded-xl border border-workspace-accent/15 bg-workspace-accent/[0.03] px-4 py-3 animate-[materialize_0.3s_cubic-bezier(0.16,1,0.3,1)_forwards]">
            <div className="relative flex items-center gap-2">
              <div className="h-6 w-6 rounded-full border border-workspace-accent/20 bg-workspace-accent/5 flex items-center justify-center">
                <span className="text-workspace-accent text-[10px] animate-pulse">✦</span>
              </div>
              <div className="absolute inset-0 w-6 h-6 rounded-full border-2 border-workspace-accent/20 border-t-workspace-accent animate-spin" />
            </div>
            <div>
              <p className="text-xs font-medium text-workspace-text">Synthesizing…</p>
              <p className="text-[10px] text-workspace-text-secondary">Analyzing cross-object patterns</p>
            </div>
          </div>
        )}

        {/* Response area */}
        <div className="space-y-4 pb-4">
          {!lastResponse && !isProcessing && (
            <div className="animate-[materialize_0.5s_cubic-bezier(0.16,1,0.3,1)_forwards]">
              <p className="text-sm leading-relaxed text-workspace-text">
                Good morning. What would you like to focus on?
              </p>
              <p className="mt-2 text-xs text-workspace-text-secondary">
                I can surface metrics, compare entities, highlight risks, or prepare a brief. Hold the mic button to speak, or ⌘K for commands.
              </p>
            </div>
          )}

          {lastResponse && (
            <div
              key={lastResponse}
              className="animate-[materialize_0.3s_cubic-bezier(0.16,1,0.3,1)_forwards]"
            >
              <p className="text-sm leading-relaxed text-workspace-text">{lastResponse}</p>
            </div>
          )}

          {/* Proactive observations */}
          {observations.length > 0 && (
            <div className="space-y-2 border-t border-workspace-border/30 pt-3">
              <span className="text-[9px] uppercase tracking-widest text-workspace-accent/50">
                Noticed
              </span>
              {observations.slice(-3).map((obs, i) => (
                <div
                  key={i}
                  className="animate-[materialize_0.4s_cubic-bezier(0.16,1,0.3,1)_forwards] rounded-lg bg-workspace-accent-subtle/20 px-3 py-2"
                >
                  <p className="text-[11px] text-workspace-text-secondary leading-relaxed">
                    {obs}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Suggestion chips */}
        <div className="space-y-2 pb-4">
          {suggestions.map((s) => (
            <button
              key={s.id}
              onClick={() => handleSuggestionClick(s.query)}
              className="block w-full rounded-lg border border-workspace-border/60 bg-workspace-surface/30 px-3.5 py-2.5
                text-left text-xs text-workspace-text transition-all duration-200
                hover:border-workspace-accent/20 hover:bg-workspace-accent-subtle/30 hover:shadow-sm"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-workspace-border/50 p-4 space-y-3">
        {/* Voice indicator */}
        <VoiceIndicator volume={voice.volume} isListening={voice.isListening} />

        <div className="flex items-center gap-2 rounded-xl border border-workspace-border bg-white px-3.5 py-2.5
          transition-all focus-within:border-workspace-accent/30 focus-within:shadow-sm">
          <span className="text-workspace-accent/40 text-sm">→</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="Ask anything..."
            className="flex-1 bg-transparent text-sm text-workspace-text placeholder:text-workspace-text-secondary/40
              outline-none"
          />

          {/* Voice button */}
          {voice.isSupported && (
            <button
              onMouseDown={(e) => { e.preventDefault(); voice.startListening(); }}
              onMouseUp={() => voice.stopListening()}
              onMouseLeave={() => { if (voice.isListening) voice.stopListening(); }}
              className={`rounded-full p-1.5 transition-all ${
                voice.isListening
                  ? 'bg-workspace-accent/15 text-workspace-accent scale-110'
                  : 'text-workspace-text-secondary/40 hover:text-workspace-accent/60 hover:bg-workspace-accent/5'
              }`}
              title="Hold to speak"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </button>
          )}

          {isProcessing && (
            <div className="h-3 w-3 rounded-full border-2 border-workspace-accent/30 border-t-workspace-accent animate-spin" />
          )}
        </div>

        {/* Canvas controls + keyboard hint */}
        <div className="flex items-center justify-between text-[9px] text-workspace-text-secondary/30">
          <span>⌘K for command palette</span>
          {activeObjectCount > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowCanvasMenu(!showCanvasMenu)}
                className="rounded px-1.5 py-0.5 text-workspace-text-secondary/40 transition-colors hover:text-workspace-text-secondary hover:bg-workspace-surface"
              >
                Canvas ▾
              </button>
              {showCanvasMenu && (
                <div className="absolute bottom-full right-0 mb-1 w-40 rounded-lg border border-workspace-border bg-white shadow-lg overflow-hidden animate-[materialize_0.2s_cubic-bezier(0.16,1,0.3,1)_forwards]">
                  <button
                    onClick={handleCollapseAll}
                    className="block w-full px-3 py-2 text-left text-[11px] text-workspace-text transition-colors hover:bg-workspace-surface"
                  >
                    Minimize all
                  </button>
                  <button
                    onClick={handleDissolveAll}
                    className="block w-full px-3 py-2 text-left text-[11px] text-destructive transition-colors hover:bg-destructive/5"
                  >
                    Clear canvas
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
