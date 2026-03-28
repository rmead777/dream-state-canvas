import { useState, useRef, useCallback, useEffect } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { useSherpa } from '@/contexts/SherpaContext';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { useAmbientAudio } from '@/hooks/useAmbientAudio';
import { useCognitiveMode } from '@/hooks/useCognitiveMode';
import { useAuth } from '@/hooks/useAuth';
import { MODE_LABELS } from '@/lib/cognitive-modes';
import { VoiceIndicator } from './VoiceIndicator';
import { RulesEditor } from './RulesEditor';
import { DocumentUpload } from './DocumentUpload';
import { DocumentContextSelector, ContextMode } from './DocumentContextSelector';
import { useDocuments } from '@/contexts/DocumentContext';
import { getDocument, extractDataset } from '@/lib/document-store';
import { setActiveDataset } from '@/lib/active-dataset';
import { invalidateProfileCache } from '@/lib/intent-engine';
import { clearProfileCache } from '@/lib/data-analyzer';
import {
  checkPassphrase, unlockAdmin, lockAdmin, isAdminUnlocked,
  getAdminSettings, setAdminModel, setAdminMaxTokens, AVAILABLE_MODELS,
} from '@/lib/admin-settings';
import { toast } from 'sonner';

export function SherpaRail() {
  const { state, dispatch } = useWorkspace();
  const { processIntent, setDocumentIds } = useWorkspaceActions();
  const { suggestions, observations, lastResponse, isProcessing } = useSherpa();
  const cognitiveMode = useCognitiveMode();
  const { play } = useAmbientAudio();
  const { user, signOut } = useAuth();
  const [input, setInput] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);
  const [showCanvasMenu, setShowCanvasMenu] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(isAdminUnlocked());
  const [adminState, setAdminState] = useState(getAdminSettings());
  const [promptHistory, setPromptHistory] = useState<Array<{ query: string; response: string | null; timestamp: number }>>([]);
  const [contextMode, setContextMode] = useState<ContextMode>('auto');
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { addDocument, documents } = useDocuments();
  const railControlsBase = 'flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-[10px] transition-all duration-200 workspace-spring';

  // Sync document IDs to the workspace actions layer
  useEffect(() => {
    if (contextMode === 'auto') {
      // In auto mode, pass all document IDs — the AI will select relevant ones
      setDocumentIds(documents.map((d) => d.id));
    } else {
      setDocumentIds(selectedDocIds);
    }
  }, [contextMode, selectedDocIds, documents, setDocumentIds]);

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

    // Check for admin passphrase
    if (checkPassphrase(trimmed)) {
      if (!adminUnlocked) {
        unlockAdmin();
        setAdminUnlocked(true);
        setAdminState(getAdminSettings());
        setShowAdmin(true);
        dispatch({ type: 'SET_SHERPA_RESPONSE', payload: '🔓 Admin mode activated. You now have access to model and token controls.' });
        toast.success('Admin mode unlocked');
      } else {
        lockAdmin();
        setAdminUnlocked(false);
        setAdminState(getAdminSettings());
        setShowAdmin(false);
        dispatch({ type: 'SET_SHERPA_RESPONSE', payload: '🔒 Admin mode deactivated. Settings reset to defaults.' });
        toast.success('Admin mode locked');
      }
      setInput('');
      return;
    }

    trackAndProcess(trimmed);
    setInput('');
  }, [input, trackAndProcess, adminUnlocked, dispatch]);

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
        className="workspace-pill fixed right-4 top-4 z-50 rounded-full px-4 py-2 text-xs text-workspace-accent transition-all duration-200 workspace-spring hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(99,102,241,0.12)]"
      >
        ✦ Sherpa
      </button>
    );
  }

  return (
    <div className="relative flex h-full w-80 flex-shrink-0 flex-col overflow-hidden border-l border-workspace-border/50 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.94),rgba(248,248,252,0.92))] backdrop-blur-xl lg:w-[340px]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(to_bottom,rgba(99,102,241,0.08),transparent)]" />

      {/* Header */}
      <div className="relative z-10 border-b border-workspace-border/40 px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-workspace-accent/10 text-sm text-workspace-accent shadow-[0_10px_24px_rgba(99,102,241,0.12)]">
                ✦
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-workspace-text">
                  Sherpa
                </span>
                <p className="mt-0.5 text-[11px] leading-5 text-workspace-text-secondary/70">
                  Ambient guide for your current analytical state
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="workspace-pill rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-workspace-accent/75 tabular-nums">
                {activeObjectCount} live objects
              </span>
              <span className="workspace-pill rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-workspace-text-secondary/70">
                {contextMode}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1">
          {cognitiveMode !== 'neutral' && (
            <span className="workspace-pill rounded-full px-2 py-1 text-[8px] uppercase tracking-[0.22em] text-workspace-accent/70 animate-[materialize_0.4s_cubic-bezier(0.16,1,0.3,1)_forwards]">
              {MODE_LABELS[cognitiveMode]}
            </span>
          )}
          {/* Admin toggle (only visible when unlocked) */}
          {adminUnlocked && (
            <button
              onClick={() => setShowAdmin(!showAdmin)}
              className={`${railControlsBase} ${
                showAdmin
                  ? 'border-workspace-accent/15 bg-workspace-accent/10 text-workspace-accent shadow-[0_10px_20px_rgba(99,102,241,0.12)]'
                  : 'text-workspace-accent/45 hover:border-workspace-border/70 hover:bg-white/90 hover:text-workspace-accent'
              }`}
              title={showAdmin ? 'Hide admin' : 'Admin controls'}
            >
              ⚡
            </button>
          )}
          {/* Upload toggle */}
          <button
            onClick={() => setShowUpload(!showUpload)}
            className={`${railControlsBase} ${
              showUpload
                ? 'border-workspace-accent/15 bg-workspace-accent/10 text-workspace-accent shadow-[0_10px_20px_rgba(99,102,241,0.12)]'
                : 'text-workspace-text-secondary/45 hover:border-workspace-border/70 hover:bg-white/90 hover:text-workspace-text-secondary'
            }`}
            title={showUpload ? 'Hide upload' : 'Upload documents'}
          >
            ↑
          </button>
          {/* Rules toggle */}
          <button
            onClick={() => setShowRules(!showRules)}
            className={`${railControlsBase} ${
              showRules
                ? 'border-workspace-accent/15 bg-workspace-accent/10 text-workspace-accent shadow-[0_10px_20px_rgba(99,102,241,0.12)]'
                : 'text-workspace-text-secondary/45 hover:border-workspace-border/70 hover:bg-white/90 hover:text-workspace-text-secondary'
            }`}
            title={showRules ? 'Hide rules' : 'Data rules'}
          >
            ⚙
          </button>
          {promptHistory.length > 0 && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`${railControlsBase} ${
                showHistory
                  ? 'border-workspace-accent/15 bg-workspace-accent/10 text-workspace-accent shadow-[0_10px_20px_rgba(99,102,241,0.12)]'
                  : 'text-workspace-text-secondary/45 hover:border-workspace-border/70 hover:bg-white/90 hover:text-workspace-text-secondary'
              }`}
              title={showHistory ? 'Hide conversation' : 'Show conversation'}
            >
              ≡
            </button>
          )}
          {(lastResponse || observations.length > 0) && (
            <button
              onClick={handleClearSherpaFull}
              className={`${railControlsBase} text-workspace-text-secondary/45 hover:border-workspace-border/70 hover:bg-white/90 hover:text-workspace-text-secondary`}
              title="Clear conversation"
            >
              ⌫
            </button>
          )}
          <button
            onClick={() => setIsExpanded(false)}
            className={`${railControlsBase} text-workspace-text-secondary hover:border-workspace-border/70 hover:bg-white/90 text-xs`}
          >
            ▸
          </button>
        </div>
      </div>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto px-5 py-4">
        {/* Rules editor panel */}
        {showRules && (
          <div className="workspace-card-surface mb-4 rounded-2xl border border-workspace-border/45 px-4 py-4">
            <RulesEditor onClose={() => setShowRules(false)} />
          </div>
        )}

        {/* Document context selector */}
        <DocumentContextSelector
          selectedDocIds={selectedDocIds}
          onSelectionChange={setSelectedDocIds}
          contextMode={contextMode}
          onModeChange={setContextMode}
        />

        {/* Admin panel */}
        {adminUnlocked && showAdmin && (
          <div className="workspace-card-surface mb-4 rounded-2xl border border-workspace-accent/15 px-4 py-4 animate-[materialize_0.3s_cubic-bezier(0.16,1,0.3,1)_forwards]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[9px] uppercase tracking-widest text-workspace-accent/60 flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-workspace-accent animate-pulse" />
                Admin Controls
              </span>
              <button
                onClick={() => setShowAdmin(false)}
                className="text-[9px] text-workspace-text-secondary/40 hover:text-workspace-text-secondary"
              >
                ✕
              </button>
            </div>

            {/* Model selector — grouped by provider */}
            <label className="block text-[10px] text-workspace-text-secondary/60 mb-1.5">AI Model</label>
            <div className="space-y-3 mb-4 max-h-[300px] overflow-y-auto pr-1">
              {(['google', 'anthropic', 'xai', 'openai'] as const).map((provider) => {
                const providerModels = AVAILABLE_MODELS.filter(m => m.provider === provider);
                if (providerModels.length === 0) return null;
                const providerLabels: Record<string, string> = { google: 'Google', anthropic: 'Anthropic', xai: 'xAI (Grok)', openai: 'OpenAI' };
                return (
                  <div key={provider}>
                    <div className="text-[9px] uppercase tracking-wider text-workspace-text-secondary/40 font-medium mb-1">{providerLabels[provider]}</div>
                    <div className="space-y-1">
                      {providerModels.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => {
                            setAdminModel(m.id);
                            setAdminState(getAdminSettings());
                            toast.success(`Model → ${m.label}`);
                          }}
                          className={`block w-full rounded-lg border px-3 py-2 text-left transition-all text-[11px] ${
                            adminState.model === m.id
                              ? 'border-workspace-accent/40 bg-workspace-accent/5 text-workspace-text'
                              : 'border-workspace-border/40 bg-workspace-surface/20 text-workspace-text-secondary hover:border-workspace-accent/20'
                          }`}
                        >
                          <span className="font-medium">{m.label}</span>
                          <span className="block text-[9px] text-workspace-text-secondary/50 mt-0.5">{m.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Token slider */}
            <label className="block text-[10px] text-workspace-text-secondary/60 mb-1.5">
              Max Tokens: <span className="font-mono text-workspace-accent">{adminState.maxTokens.toLocaleString()}</span>
            </label>
            <input
              type="range"
              min={256}
              max={32768}
              step={256}
              value={adminState.maxTokens}
              onChange={(e) => {
                setAdminMaxTokens(Number(e.target.value));
                setAdminState(getAdminSettings());
              }}
              className="w-full h-1.5 rounded-full appearance-none bg-workspace-border/40 accent-workspace-accent cursor-pointer"
            />
            <div className="flex justify-between text-[8px] text-workspace-text-secondary/30 mt-1">
              <span>256</span>
              <span>32,768</span>
            </div>
          </div>
        )}


        {showUpload && (
          <div className="workspace-card-surface mb-4 rounded-2xl border border-workspace-border/45 px-4 py-4">
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
          <div className="workspace-card-surface mb-4 rounded-2xl border border-workspace-border/45 px-4 py-4 space-y-3">
            <span className="text-[9px] uppercase tracking-widest text-workspace-text-secondary/40">
              History
            </span>
            {promptHistory.map((entry, _i) => (
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
          <div className="relative rounded-2xl border border-workspace-accent/20 bg-gradient-to-b from-workspace-accent/[0.08] via-white/90 to-white/80 px-4 py-4 shadow-[0_18px_46px_rgba(99,102,241,0.1)] animate-[materialize_0.3s_cubic-bezier(0.16,1,0.3,1)_forwards] overflow-hidden">
            {/* Animated scan line */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-workspace-accent/40 to-transparent animate-[scanline_2s_linear_infinite]" />
            </div>

            {/* Orbital spinner */}
            <div className="flex items-center gap-3">
              <div className="relative h-8 w-8 flex-shrink-0">
                {/* Outer ring */}
                <div className="absolute inset-0 rounded-full border border-workspace-accent/15 animate-[spin_3s_linear_infinite]">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-px h-1.5 w-1.5 rounded-full bg-workspace-accent/60" />
                </div>
                {/* Inner ring — counter-rotate */}
                <div className="absolute inset-1 rounded-full border border-workspace-accent/10 animate-[spin_2s_linear_infinite_reverse]">
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-px h-1 w-1 rounded-full bg-workspace-accent/40" />
                </div>
                {/* Core pulse */}
                <div className="absolute inset-2.5 rounded-full bg-workspace-accent/10 animate-[pulse_1.5s_cubic-bezier(0.34,1.56,0.64,1)_infinite]">
                  <div className="absolute inset-0.5 rounded-full bg-workspace-accent/20" />
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-workspace-text tracking-wide">Processing…</p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  {/* Animated progress dots */}
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="h-1 rounded-full bg-workspace-accent/30 animate-[progressDot_1.5s_cubic-bezier(0.34,1.56,0.64,1)_infinite]"
                      style={{
                        width: '12px',
                        animationDelay: `${i * 0.15}s`,
                      }}
                    />
                  ))}
                  <span className="text-[9px] text-workspace-text-secondary/50 ml-1 tabular-nums animate-pulse">
                    reasoning
                  </span>
                </div>
              </div>
            </div>

            {/* Data stream effect at bottom */}
            <div className="mt-3 flex gap-0.5 overflow-hidden h-0.5">
              {Array.from({ length: 20 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-full bg-workspace-accent/20 animate-[dataStream_2s_linear_infinite]"
                  style={{ animationDelay: `${i * 0.1}s` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Response area */}
        <div id="sherpa-response-region" aria-live="polite" className="space-y-4 pb-4">
          {!lastResponse && !isProcessing && (
            <div className="workspace-card-surface animate-[materialize_0.5s_cubic-bezier(0.16,1,0.3,1)_forwards] rounded-2xl border border-workspace-border/45 px-4 py-4">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.22em] text-workspace-accent/70">Conversation starter</div>
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
              className="workspace-card-surface animate-[materialize_0.3s_cubic-bezier(0.16,1,0.3,1)_forwards] rounded-2xl border border-workspace-border/45 px-4 py-4"
            >
              <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.22em] text-workspace-accent/70">Verdict</div>
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
              className="workspace-focus-ring block w-full rounded-2xl border border-workspace-border/60 bg-white/78 px-4 py-3.5
                text-left text-xs text-workspace-text transition-all duration-200 workspace-spring
                hover:-translate-y-0.5 hover:border-workspace-accent/20 hover:bg-workspace-accent-subtle/30 hover:shadow-[0_18px_38px_rgba(99,102,241,0.12)]"
            >
              <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-workspace-accent/65">Suggested next move</div>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input area */}
      <div className="relative z-10 border-t border-workspace-border/50 bg-white/70 p-4 space-y-3 backdrop-blur-md">
        {/* Voice indicator */}
        <VoiceIndicator volume={voice.volume} isListening={voice.isListening} />

        <div className="workspace-card-surface flex items-center gap-2 rounded-2xl border border-workspace-border/60 px-3.5 py-2.5
          transition-all duration-200 workspace-spring focus-within:border-workspace-accent/30 focus-within:shadow-[0_16px_34px_rgba(99,102,241,0.12)]"
          aria-busy={isProcessing}
        >
          <span className="text-workspace-accent/40 text-sm">→</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
              }
            }}
            aria-label="Ask Sherpa about your workspace"
            aria-describedby="sherpa-composer-hint"
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
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !voice.isListening) {
                  e.preventDefault();
                  voice.startListening();
                }
              }}
              onKeyUp={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && voice.isListening) {
                  e.preventDefault();
                  voice.stopListening();
                }
              }}
              onBlur={() => { if (voice.isListening) voice.stopListening(); }}
              aria-label={voice.isListening ? 'Stop voice dictation' : 'Hold to dictate to Sherpa'}
              aria-pressed={voice.isListening}
              className={`workspace-focus-ring rounded-full p-2 transition-all duration-200 workspace-spring ${
                voice.isListening
                  ? 'bg-workspace-accent/15 text-workspace-accent scale-110 shadow-[0_10px_24px_rgba(99,102,241,0.14)]'
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

          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isProcessing}
            className="workspace-focus-ring rounded-full border border-workspace-accent/15 bg-workspace-accent/10 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-workspace-accent transition-all duration-200 workspace-spring hover:-translate-y-0.5 hover:bg-workspace-accent/15 disabled:translate-y-0 disabled:opacity-45"
          >
            {isProcessing ? 'Working…' : 'Send'}
          </button>
        </div>

        <p id="sherpa-composer-hint" className="px-1 text-[10px] leading-5 text-workspace-text-secondary/55">
          Press Enter to send, hold the mic to dictate, or use ⌘K for direct object commands.
        </p>

        {/* Canvas controls + user */}
        <div className="flex items-center justify-between text-[9px] text-workspace-text-secondary/35">
          <div className="flex items-center gap-2">
            <span>⌘K</span>
            {user && (
              <button
                onClick={signOut}
                className="workspace-focus-ring rounded px-1.5 py-0.5 text-workspace-text-secondary/40 transition-colors hover:text-destructive hover:bg-destructive/5"
                title={`Sign out (${user.email})`}
              >
                Sign out
              </button>
            )}
          </div>
          {activeObjectCount > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowCanvasMenu(!showCanvasMenu)}
                className="workspace-focus-ring workspace-pill rounded-full px-2 py-1 text-workspace-text-secondary/55 transition-colors hover:text-workspace-text-secondary"
              >
                Canvas ▾
              </button>
              {showCanvasMenu && (
                <div className="workspace-card-surface absolute bottom-full right-0 mb-2 w-40 rounded-2xl border border-workspace-border/55 overflow-hidden animate-[materialize_0.2s_cubic-bezier(0.16,1,0.3,1)_forwards]">
                  <button
                    onClick={handleCollapseAll}
                    className="workspace-focus-ring block w-full px-3 py-2 text-left text-[11px] text-workspace-text transition-colors hover:bg-workspace-surface"
                  >
                    Minimize all
                  </button>
                  <button
                    onClick={handleDissolveAll}
                    className="workspace-focus-ring block w-full px-3 py-2 text-left text-[11px] text-destructive transition-colors hover:bg-destructive/5"
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
