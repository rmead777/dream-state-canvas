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
import { DocumentContextSelector, ContextMode } from './DocumentContextSelector';
import { useDocuments } from '@/contexts/DocumentContext';
import { setActiveDataset } from '@/lib/active-dataset';
import { invalidateProfileCache } from '@/lib/intent-engine';
import { clearProfileCache } from '@/lib/data-analyzer';
import {
  checkPassphrase, unlockAdmin, lockAdmin, isAdminUnlocked,
  getAdminSettings, setAdminModel, setAdminMaxTokens, setAdminContextWindow, AVAILABLE_MODELS,
} from '@/lib/admin-settings';
import { toast } from 'sonner';
import { PromptEditor } from './PromptEditor';
import { MemoryPanel } from './MemoryPanel';
import { RulesEditor } from './RulesEditor';
import { AITelemetryPanel } from './AITelemetryPanel';

const RAIL_MIN_WIDTH = 320;
const RAIL_MAX_WIDTH = 800;
const RAIL_DEFAULT_WIDTH = 440;
const RAIL_WIDTH_KEY = 'sherpa-rail-width';

type RailTab = 'origin' | 'memory' | 'rules' | 'context' | 'admin' | 'log';

const TAB_CONFIG: { id: RailTab; label: string; adminOnly?: boolean }[] = [
  { id: 'origin', label: 'Origin' },
  { id: 'memory', label: 'Memory' },
  { id: 'rules', label: 'Rules' },
  { id: 'context', label: 'Context' },
  { id: 'admin', label: 'Admin', adminOnly: true },
  { id: 'log', label: 'Log', adminOnly: true },
];

export function SherpaRail() {
  const { state, dispatch } = useWorkspace();
  const { processIntent, setDocumentIds } = useWorkspaceActions();
  const { suggestions, observations, lastResponse, isProcessing } = useSherpa();
  const cognitiveMode = useCognitiveMode();
  const { play } = useAmbientAudio();
  const { user, signOut } = useAuth();
  const [input, setInput] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<RailTab>('origin');

  // Resizable width
  const [railWidth, setRailWidth] = useState(() => {
    try {
      const stored = localStorage.getItem(RAIL_WIDTH_KEY);
      return stored ? Math.max(RAIL_MIN_WIDTH, Math.min(RAIL_MAX_WIDTH, parseInt(stored))) : RAIL_DEFAULT_WIDTH;
    } catch { return RAIL_DEFAULT_WIDTH; }
  });
  const isDraggingRef = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const startX = e.clientX;
    const startWidth = railWidth;

    let currentWidth = startWidth;

    const onMouseMove = (e: MouseEvent) => {
      const delta = startX - e.clientX;
      currentWidth = Math.max(RAIL_MIN_WIDTH, Math.min(RAIL_MAX_WIDTH, startWidth + delta));
      setRailWidth(currentWidth);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem(RAIL_WIDTH_KEY, String(currentWidth)); } catch {}
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [railWidth]);

  const [adminUnlocked, setAdminUnlocked] = useState(isAdminUnlocked());
  const [adminState, setAdminState] = useState(getAdminSettings());
  const [promptHistory, setPromptHistory] = useState<Array<{ query: string; response: string | null; timestamp: number }>>([]);
  const [contextMode, setContextMode] = useState<ContextMode>('auto');
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { addDocument, documents } = useDocuments();

  const contextScopeLabel = contextMode === 'auto'
    ? `${documents.length} docs`
    : `${selectedDocIds.length} selected`;

  // Close model dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    if (showModelDropdown) {
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }
  }, [showModelDropdown]);

  // Sync document IDs to the workspace actions layer
  useEffect(() => {
    if (contextMode === 'auto') {
      setDocumentIds(documents.map((d) => d.id));
    } else {
      setDocumentIds(selectedDocIds);
    }
  }, [contextMode, selectedDocIds, documents, setDocumentIds]);

  const activeObjectCount = Object.values(state.objects).filter(o => o.status !== 'dissolved').length;

  // Sync Sherpa responses into the conversation thread
  useEffect(() => {
    if (lastResponse && promptHistory.length > 0) {
      const last = promptHistory[promptHistory.length - 1];
      if (last.response !== lastResponse) {
        setPromptHistory(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], response: lastResponse };
          return updated;
        });
      }
    }
  }, [lastResponse]);

  // Scroll to BOTTOM so newest messages are always visible
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeTab !== 'origin') return;
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [lastResponse, isProcessing, activeTab]);

  const trackAndProcess = useCallback((text: string) => {
    setPromptHistory(prev => [...prev, { query: text, response: null, timestamp: Date.now() }]);
    setActiveTab('origin'); // Switch to Origin when sending a message
    processIntent(text);
  }, [processIntent]);

  // Listen for sherpa-query events from empty state buttons
  useEffect(() => {
    const handler = (e: Event) => {
      const query = (e as CustomEvent).detail;
      if (typeof query === 'string' && query.trim()) {
        trackAndProcess(query);
      }
    };
    document.addEventListener('sherpa-query', handler);
    return () => document.removeEventListener('sherpa-query', handler);
  }, [trackAndProcess]);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Check for admin passphrase
    if (checkPassphrase(trimmed)) {
      if (!adminUnlocked) {
        unlockAdmin();
        setAdminUnlocked(true);
        setAdminState(getAdminSettings());
        dispatch({ type: 'SET_SHERPA_RESPONSE', payload: 'Admin mode activated. You now have access to model and token controls.' });
        toast.success('Admin mode unlocked');
      } else {
        lockAdmin();
        setAdminUnlocked(false);
        setAdminState(getAdminSettings());
        dispatch({ type: 'SET_SHERPA_RESPONSE', payload: 'Admin mode deactivated. Settings reset to defaults.' });
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
  const composerState = voice.isListening ? 'Listening' : isProcessing ? 'Reasoning' : input.trim() ? 'Ready to send' : 'Standing by';
  const composerStateTone = voice.isListening ? 'bg-rose-500' : isProcessing ? 'bg-amber-500' : input.trim() ? 'bg-emerald-500' : 'bg-workspace-accent';

  const handleSuggestionClick = (query: string) => {
    trackAndProcess(query);
  };

  const handleClearSherpaFull = useCallback(() => {
    dispatch({ type: 'CLEAR_SHERPA' });
    setPromptHistory([]);
    toast.success('Conversation cleared');
  }, [dispatch]);

  // Current model label for the dropdown button
  const currentModel = AVAILABLE_MODELS.find(m => m.id === adminState.model);
  const modelLabel = currentModel?.label || adminState.model.split('/').pop() || 'Model';

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="workspace-pill fixed right-4 top-4 z-50 rounded-full px-4 py-2 text-xs text-workspace-accent transition-all duration-200 workspace-spring hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(99,102,241,0.12)]"
      >
        Sherpa
      </button>
    );
  }

  // Determine which tabs to show
  const visibleTabs = TAB_CONFIG.filter(t => !t.adminOnly || adminUnlocked);

  return (
    <div
      className="workspace-noise relative flex h-full flex-shrink-0 flex-col overflow-hidden border-l border-workspace-border/50 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.94),rgba(248,248,252,0.92))] backdrop-blur-xl"
      style={{ width: `${railWidth}px` }}
    >
      {/* Drag handle — left edge */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute left-0 top-0 bottom-0 w-1 z-30 cursor-col-resize hover:bg-workspace-accent/20 active:bg-workspace-accent/30 transition-colors"
        title="Drag to resize"
      />

      {/* ═══ HEADER ═══ */}
      <div className="relative z-10 border-b border-workspace-border/40 px-4 pt-3 pb-0">
        {/* Row 1: identity + controls */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-workspace-accent/10 text-xs text-workspace-accent">
              ✦
            </div>
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-workspace-text">
              Sherpa
            </span>
            {cognitiveMode !== 'neutral' && (
              <span className="rounded-full bg-workspace-accent/8 px-2 py-0.5 text-[8px] uppercase tracking-[0.18em] text-workspace-accent/70">
                {MODE_LABELS[cognitiveMode]}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {(lastResponse || observations.length > 0 || promptHistory.length > 0) && (
              <button
                onClick={handleClearSherpaFull}
                className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] text-workspace-text-secondary/40 hover:bg-workspace-surface/60 hover:text-workspace-text-secondary transition-colors"
                title="Clear conversation"
              >
                ⌫
              </button>
            )}
            <button
              onClick={() => setIsExpanded(false)}
              className="flex h-6 w-6 items-center justify-center rounded-full text-xs text-workspace-text-secondary/40 hover:bg-workspace-surface/60 hover:text-workspace-text-secondary transition-colors"
            >
              ▸
            </button>
          </div>
        </div>

        {/* ═══ UTILITY TAB BAR ═══ */}
        <div className="flex items-center gap-0.5 -mb-px overflow-x-auto">
          {visibleTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative px-2.5 py-1.5 text-[11px] font-medium transition-colors whitespace-nowrap
                ${activeTab === tab.id
                  ? 'text-workspace-accent'
                  : 'text-workspace-text-secondary/60 hover:text-workspace-text-secondary'
                }`}
            >
              {tab.label}
              {/* Active indicator */}
              {activeTab === tab.id && (
                <span className="absolute inset-x-1 bottom-0 h-[2px] rounded-full bg-workspace-accent" />
              )}
            </button>
          ))}

          {/* Model dropdown — right-aligned at end of tab bar */}
          <div className="ml-auto relative" ref={modelDropdownRef}>
            <button
              onClick={() => adminUnlocked ? setShowModelDropdown(!showModelDropdown) : null}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] transition-colors
                ${adminUnlocked
                  ? 'text-workspace-accent/70 hover:bg-workspace-accent/5 hover:text-workspace-accent cursor-pointer'
                  : 'text-workspace-text-secondary/40 cursor-default'
                }`}
              title={adminUnlocked ? 'Switch model' : 'Unlock admin to change model'}
            >
              <span className="truncate max-w-[100px]">{modelLabel}</span>
              {adminUnlocked && <span className="text-[8px]">▾</span>}
            </button>

            {/* Model dropdown panel */}
            {showModelDropdown && adminUnlocked && (
              <div className="absolute right-0 top-full mt-1 z-50 w-64 max-h-80 overflow-y-auto rounded-xl border border-workspace-border/45 bg-white shadow-lg animate-[materialize_0.15s_cubic-bezier(0.16,1,0.3,1)_forwards]">
                {(['google', 'anthropic', 'xai', 'openai'] as const).map((provider) => {
                  const providerModels = AVAILABLE_MODELS.filter(m => m.provider === provider);
                  if (providerModels.length === 0) return null;
                  const providerLabels: Record<string, string> = { google: 'Google', anthropic: 'Anthropic', xai: 'xAI', openai: 'OpenAI' };
                  return (
                    <div key={provider} className="py-1">
                      <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-workspace-text-secondary/40 font-medium">
                        {providerLabels[provider]}
                      </div>
                      {providerModels.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => {
                            setAdminModel(m.id);
                            setAdminState(getAdminSettings());
                            setShowModelDropdown(false);
                            toast.success(`Model → ${m.label}`);
                          }}
                          className={`block w-full px-3 py-1.5 text-left text-[11px] transition-colors
                            ${adminState.model === m.id
                              ? 'bg-workspace-accent/5 text-workspace-accent font-medium'
                              : 'text-workspace-text hover:bg-workspace-surface/50'
                            }`}
                        >
                          {m.label}
                          <span className="block text-[9px] text-workspace-text-secondary/50">{m.description}</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ TAB CONTENT ═══ */}
      {activeTab === 'origin' ? (
        <>
          {/* Scrollable chat area — takes most of the space */}
          <div ref={scrollContainerRef} className="relative z-10 flex-1 overflow-y-auto px-4 py-3">
            {/* Compact session pulse */}
            <div className="mb-3 flex items-center gap-2 px-1">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${composerStateTone} ${voice.isListening || isProcessing ? 'animate-pulse' : ''}`} />
              <span className="text-[10px] uppercase tracking-[0.16em] text-workspace-text-secondary/50">{composerState}</span>
              <span className="ml-auto text-[10px] text-workspace-text-secondary/40 tabular-nums">{activeObjectCount} live · {contextScopeLabel}</span>
            </div>

            {/* ═══ Chat Thread ═══ */}
            <div className="space-y-3">
              {promptHistory.length === 0 && !lastResponse && !isProcessing && (
                <div className="rounded-2xl border border-workspace-border/30 bg-workspace-surface/20 px-4 py-4 text-center">
                  <p className="text-sm text-workspace-text/80">Good morning. What would you like to focus on?</p>
                  <p className="mt-1.5 text-[11px] text-workspace-text-secondary/50">
                    Ask anything — I'll materialize the right views for you.
                  </p>
                </div>
              )}

              {promptHistory.map((entry, i) => (
                <div key={entry.timestamp} className="space-y-2">
                  {/* User message — right-aligned */}
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-workspace-accent/10 border border-workspace-accent/15 px-3.5 py-2.5">
                      <p className="text-sm text-workspace-text leading-relaxed">{entry.query}</p>
                    </div>
                  </div>
                  {/* Sherpa response — left-aligned */}
                  {entry.response && (
                    <div className="flex justify-start">
                      <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-white border border-workspace-border/40 px-3.5 py-2.5 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                        <p className="text-sm text-workspace-text leading-relaxed">{entry.response}</p>
                      </div>
                    </div>
                  )}
                  {/* Processing indicator after last message */}
                  {i === promptHistory.length - 1 && !entry.response && isProcessing && (
                    <div className="flex justify-start">
                      <div className="rounded-2xl rounded-bl-md bg-white border border-workspace-border/40 px-3.5 py-2.5 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            {[0, 1, 2].map(j => (
                              <div key={j} className="h-1.5 w-1.5 rounded-full bg-workspace-accent/40 animate-pulse" style={{ animationDelay: `${j * 200}ms` }} />
                            ))}
                          </div>
                          <span className="text-[10px] text-workspace-accent/60">Reasoning...</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Proactive observations — compact, below chat */}
              {observations.length > 0 && (
                <div className="mt-4 space-y-1.5 border-t border-workspace-border/30 pt-3">
                  <span className="text-[9px] uppercase tracking-widest text-workspace-accent/50">Noticed</span>
                  {observations.slice(-2).map((obs, i) => (
                    <p key={i} className="text-[11px] text-workspace-text-secondary/60 leading-relaxed px-1">{obs}</p>
                  ))}
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          </div>

          {/* ═══ NEXT MOVES — quarantined bottom section ═══ */}
          {suggestions.length > 0 && (
            <div className="relative z-10 border-t border-workspace-border/40 px-4 py-2.5 bg-workspace-surface/20">
              <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-workspace-accent/55 mb-1.5 block">
                Next Moves
              </span>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleSuggestionClick(s.query)}
                    className="rounded-full border border-workspace-border/50 bg-white/80 px-2.5 py-1
                      text-[10px] text-workspace-text transition-all duration-200
                      hover:border-workspace-accent/20 hover:bg-workspace-accent/5 hover:text-workspace-accent"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ═══ INPUT AREA ═══ */}
          <div className="relative z-10 border-t border-workspace-border/50 bg-white/70 px-4 py-3 space-y-2 backdrop-blur-md">
            {/* Processing indicator */}
            {isProcessing && (
              <div
                className="relative overflow-hidden rounded-2xl border border-workspace-accent/30 bg-[linear-gradient(135deg,rgba(99,102,241,0.13),rgba(99,102,241,0.06),rgba(99,102,241,0.13))] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_12px_32px_rgba(99,102,241,0.20)] animate-[materialize_0.25s_cubic-bezier(0.16,1,0.3,1)_forwards]"
                role="status"
                aria-label="Sherpa is reasoning"
              >
                {/* Vertical scanline sweep */}
                <div className="pointer-events-none absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-workspace-accent/55 to-transparent animate-[scanline_2s_linear_infinite]" />
                {/* Data stream at bottom edge */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-0.5 gap-px overflow-hidden rounded-b-2xl">
                  {Array.from({ length: 18 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-workspace-accent/20 animate-[dataStream_2s_linear_infinite]"
                      style={{ animationDelay: `${i * 0.11}s` }}
                    />
                  ))}
                </div>
                <div className="relative flex items-center gap-3">
                  {/* Orbital spinner */}
                  <div className="relative h-7 w-7 shrink-0">
                    <div className="absolute inset-0 rounded-full border border-workspace-accent/30 animate-[spin_2.5s_linear_infinite]">
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-px h-1.5 w-1.5 rounded-full bg-workspace-accent" />
                    </div>
                    <div className="absolute inset-1 rounded-full border border-workspace-accent/15 animate-[spin_1.8s_linear_infinite_reverse]">
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-px h-1 w-1 rounded-full bg-workspace-accent/65" />
                    </div>
                    <div className="absolute inset-2.5 rounded-full bg-workspace-accent/20 animate-[pulse_1.5s_cubic-bezier(0.34,1.56,0.64,1)_infinite]" />
                  </div>
                  {/* Label + progress dots */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold tracking-wide text-workspace-accent">Reasoning</span>
                      <div className="flex items-center gap-1">
                        {[0, 1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className="h-1 w-3 rounded-full bg-workspace-accent/45 animate-[progressDot_1.2s_cubic-bezier(0.34,1.56,0.64,1)_infinite]"
                            style={{ animationDelay: `${i * 0.15}s` }}
                          />
                        ))}
                      </div>
                    </div>
                    <p className="mt-0.5 text-[10px] leading-4 text-workspace-accent/65">
                      Sherpa is analyzing your workspace
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Voice indicator */}
            <VoiceIndicator volume={voice.volume} isListening={voice.isListening} />

            <div className="workspace-card-surface flex items-center gap-2 rounded-2xl border border-workspace-border/60 px-3 py-2
              transition-all duration-200 workspace-spring focus-within:border-workspace-accent/30 focus-within:shadow-[0_12px_28px_rgba(99,102,241,0.10)]"
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
                placeholder="Ask anything..."
                className="flex-1 bg-transparent text-sm text-workspace-text placeholder:text-workspace-text-secondary/40 outline-none"
              />

              {/* Voice button */}
              {voice.isSupported && (
                <button
                  onMouseDown={(e) => { e.preventDefault(); voice.startListening(); }}
                  onMouseUp={() => voice.stopListening()}
                  onMouseLeave={() => { if (voice.isListening) voice.stopListening(); }}
                  className={`rounded-full p-1.5 transition-all duration-200 ${
                    voice.isListening
                      ? 'bg-workspace-accent/15 text-workspace-accent scale-110'
                      : 'text-workspace-text-secondary/40 hover:text-workspace-accent/60 hover:bg-workspace-accent/5'
                  }`}
                  title="Hold to speak"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" x2="12" y1="19" y2="22" />
                  </svg>
                </button>
              )}

              <button
                onClick={handleSubmit}
                disabled={!input.trim() || isProcessing}
                className="rounded-full border border-workspace-accent/15 bg-workspace-accent/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-workspace-accent transition-all duration-200 hover:bg-workspace-accent/15 disabled:opacity-45"
              >
                {isProcessing ? 'Working…' : 'Send'}
              </button>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between text-[9px] text-workspace-text-secondary/35 px-1">
              <span>Enter to send · Hold mic to dictate</span>
              {user && (
                <button
                  onClick={signOut}
                  className="rounded px-1.5 py-0.5 text-workspace-text-secondary/40 transition-colors hover:text-destructive hover:bg-destructive/5"
                  title={`Sign out (${user.email})`}
                >
                  Sign out
                </button>
              )}
            </div>
          </div>
        </>
      ) : (
        /* ═══ NON-ORIGIN TAB CONTENT ═══ */
        <div className="relative z-10 flex-1 overflow-y-auto px-4 py-4">
          {activeTab === 'memory' && <MemoryPanel />}

          {activeTab === 'rules' && (
            <RulesEditor onClose={() => setActiveTab('origin')} />
          )}

          {activeTab === 'context' && (
            <div className="space-y-4">
              <div className="space-y-0.5">
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/75">
                  Document Context
                </span>
                <p className="text-[11px] text-workspace-text-secondary">
                  Control which documents Sherpa considers for each query.
                </p>
              </div>
              <DocumentContextSelector
                selectedDocIds={selectedDocIds}
                onSelectionChange={setSelectedDocIds}
                contextMode={contextMode}
                onModeChange={setContextMode}
              />
            </div>
          )}

          {activeTab === 'admin' && adminUnlocked && (
            <div className="space-y-5">
              <div className="flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-workspace-accent animate-pulse" />
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/75">
                  Admin Controls
                </span>
              </div>

              {/* Model selector — full panel version */}
              <div>
                <label className="block text-[10px] text-workspace-text-secondary/60 mb-1.5">AI Model</label>
                <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
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
              </div>

              {/* Token slider */}
              <div>
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

              {/* Context window slider */}
              <div>
                <label className="block text-[10px] text-workspace-text-secondary/60 mb-1.5">
                  Conversation Memory: <span className="font-mono text-workspace-accent">{adminState.contextWindow} turns</span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={50}
                  step={1}
                  value={adminState.contextWindow}
                  onChange={(e) => {
                    setAdminContextWindow(Number(e.target.value));
                    setAdminState(getAdminSettings());
                  }}
                  className="w-full h-1.5 rounded-full appearance-none bg-workspace-border/40 accent-workspace-accent cursor-pointer"
                />
                <div className="flex justify-between text-[8px] text-workspace-text-secondary/30 mt-1">
                  <span>1 turn</span>
                  <span>50 turns</span>
                </div>
              </div>

              {/* Prompt Editor */}
              <div className="pt-4 border-t border-workspace-border/30">
                <PromptEditor />
              </div>
            </div>
          )}

          {activeTab === 'log' && adminUnlocked && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/75">
                  AI Call Log
                </span>
              </div>
              <AITelemetryPanel />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
