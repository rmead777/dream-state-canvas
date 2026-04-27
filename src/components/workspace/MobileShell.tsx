import { useState, useCallback, useEffect, useRef } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { useSherpa } from '@/contexts/SherpaContext';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { useAmbientAudio } from '@/hooks/useAmbientAudio';
import { useAuth } from '@/hooks/useAuth';
import { useDocuments } from '@/contexts/DocumentContext';
import { MobileTabBar, MobileTab } from './MobileTabBar';
import { MobileCardStack } from './MobileCardStack';
import { ImmersiveOverlay } from './ImmersiveOverlay';
import { VoiceIndicator } from './VoiceIndicator';
import { DocumentContextSelector, ContextMode } from './DocumentContextSelector';
import { QBOStatusPanel } from './QBOStatusPanel';
import { OutlookStatusPanel } from './OutlookStatusPanel';
import { Notebook } from './Notebook';
import { ThinkingStrip } from './ThinkingStrip';
import { InterjectComposer } from './InterjectComposer';
import { ErrorTray } from './ErrorTray';
import MarkdownRenderer from '../objects/MarkdownRenderer';
import { compressImage } from '@/lib/image-utils';
import { extractDataset } from '@/lib/document-store';
import {
  checkPassphrase, unlockAdmin, lockAdmin, isAdminUnlocked,
  getAdminSettings, setAdminModel, setAdminMaxTokens, setAdminContextWindow,
  setAdminAgentMaxIterations,
  AVAILABLE_MODELS,
} from '@/lib/admin-settings';
import { AITelemetryPanel } from './AITelemetryPanel';
import { BackgroundShader } from './BackgroundShader';
import { PromptEditor } from './PromptEditor';
import { toast } from 'sonner';

export function MobileShell() {
  const { state, dispatch } = useWorkspace();
  const { processIntent, setDocumentIds } = useWorkspaceActions();
  const { suggestions, lastResponse, processingStatus, isProcessing } = useSherpa();
  const { play } = useAmbientAudio();
  const { user, signOut } = useAuth();
  const { documents } = useDocuments();

  const [activeTab, setActiveTab] = useState<MobileTab>('chat');
  const [input, setInput] = useState('');
  const [promptHistory, setPromptHistory] = useState<Array<{
    query: string;
    response: string | null;
    timestamp: number;
    steps?: string[];
    images?: string[];
    error?: { code: string; message: string; detail?: string };
  }>>([]);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [contextMode, setContextMode] = useState<ContextMode>('auto');
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [adminUnlocked, setAdminUnlocked] = useState(isAdminUnlocked());
  const [adminState, setAdminState] = useState(getAdminSettings());
  const inputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isImmersive = !!state.activeContext.immersiveObjectId;

  // Sync document IDs
  useEffect(() => {
    if (contextMode === 'auto') {
      setDocumentIds(documents.map((d) => d.id));
    } else {
      setDocumentIds(selectedDocIds);
    }
  }, [contextMode, selectedDocIds, documents, setDocumentIds]);

  // Sync Sherpa responses
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

  // Auto-scroll chat
  useEffect(() => {
    if (activeTab !== 'chat') return;
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [lastResponse, isProcessing, activeTab]);

  const trackAndProcess = useCallback(async (text: string, images?: string[]) => {
    const ts = Date.now();
    setPromptHistory(prev => [...prev, { query: text, response: null, timestamp: ts, images }]);
    setActiveTab('chat');
    const result = await processIntent(text, images);
    setPromptHistory(prev => prev.map(e => {
      if (e.timestamp !== ts) return e;
      return {
        ...e,
        ...(result?.steps?.length ? { steps: result.steps } : {}),
        ...(result?.error ? { error: result.error } : {}),
      };
    }));
    if (result?.error) {
      toast.error(result.error.message, { duration: 5000 });
    }
  }, [processIntent]);

  // Listen for sherpa-query events
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
    if (!trimmed && pendingImages.length === 0) return;

    // Admin passphrase check
    if (trimmed && checkPassphrase(trimmed)) {
      if (!adminUnlocked) {
        unlockAdmin();
        setAdminUnlocked(true);
        dispatch({ type: 'SET_SHERPA_RESPONSE', payload: 'Admin mode activated.' });
        toast.success('Admin mode unlocked');
      } else {
        lockAdmin();
        setAdminUnlocked(false);
        if (activeTab === 'admin') setActiveTab('chat');
        dispatch({ type: 'SET_SHERPA_RESPONSE', payload: 'Admin mode deactivated.' });
        toast.success('Admin mode locked');
      }
      setInput('');
      return;
    }

    const images = pendingImages.length > 0 ? pendingImages : undefined;
    trackAndProcess(trimmed || 'What do you see in this image?', images);
    setInput('');
    setPendingImages([]);
  }, [input, pendingImages, trackAndProcess, adminUnlocked, dispatch]);

  const handleVoiceResult = useCallback((transcript: string) => {
    play('focus');
    trackAndProcess(transcript);
  }, [trackAndProcess, play]);

  const handleVoiceInterim = useCallback((transcript: string) => {
    setInput(transcript);
  }, []);

  const voice = useVoiceInput({ onResult: handleVoiceResult, onInterim: handleVoiceInterim });

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    const compressed = await Promise.all(imageItems.map(item => compressImage(item.getAsFile()!)));
    setPendingImages(prev => [...prev, ...compressed]);
  }, []);

  const handleImageFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    const compressed = await Promise.all(imageFiles.map(compressImage));
    setPendingImages(prev => [...prev, ...compressed]);
  }, []);

  const handleClearChat = useCallback(() => {
    dispatch({ type: 'CLEAR_SHERPA' });
    setPromptHistory([]);
  }, [dispatch]);

  const handleOpenDocument = useCallback((doc: { id: string; filename: string; file_type: string; structured_data: any }) => {
    const isSpreadsheet = doc.file_type === 'xlsx' || doc.file_type === 'csv';
    const objectType = isSpreadsheet ? 'dataset' : 'document';
    const existing = Object.values(state.objects).find(
      (o: any) => o.context?.sourceDocId === doc.id && o.status !== 'dissolved'
    );
    if (existing) {
      dispatch({ type: 'ENTER_IMMERSIVE', payload: { id: existing.id } });
      return;
    }
    const objId = `doc-view-${doc.id.slice(0, 8)}-${Date.now()}`;
    const dataset = isSpreadsheet ? extractDataset(doc as any) : null;
    dispatch({
      type: 'MATERIALIZE_OBJECT',
      payload: {
        id: objId,
        type: objectType,
        title: doc.filename,
        pinned: false,
        origin: { type: 'user-query' as const, query: `Open ${doc.filename}` },
        relationships: [],
        context: {
          sourceDocId: doc.id,
          columns: dataset?.columns || [],
          rows: dataset?.rows || [],
        },
        position: { zone: 'primary' as const, order: 0 },
      },
    });
    requestAnimationFrame(() => {
      dispatch({ type: 'ENTER_IMMERSIVE', payload: { id: objId } });
    });
  }, [state.objects, dispatch]);

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <BackgroundShader />
      {/* Immersive overlay */}
      <ImmersiveOverlay />

      {/* Top bar */}
      <div className={`relative z-20 flex items-center justify-between border-b border-workspace-border/40 bg-white/80 px-4 py-2.5 backdrop-blur-xl ${isImmersive ? 'hidden' : ''}`}>
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-workspace-accent/10 text-xs text-workspace-accent">
            ✦
          </div>
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-workspace-text">Sherpa</span>
        </div>
        <div className="flex items-center gap-2">
          {promptHistory.length > 0 && activeTab === 'chat' && (
            <button
              onClick={handleClearChat}
              className="rounded-full p-2 text-workspace-text-secondary/40 hover:text-workspace-text-secondary transition-colors"
              title="Clear chat"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              </svg>
            </button>
          )}
          {user && (
            <button
              onClick={signOut}
              className="rounded-full px-2 py-1 text-[10px] text-workspace-text-secondary/40 hover:text-destructive transition-colors"
              title={`Sign out (${user.email})`}
            >
              Sign out
            </button>
          )}
        </div>
      </div>

      {/* Tab content */}
      {!isImmersive && (
        <>
          {activeTab === 'chat' && (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Chat thread */}
              <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-3">
                <div className="space-y-3">
                  {promptHistory.length === 0 && !lastResponse && !isProcessing && (
                    <div className="rounded-2xl border border-workspace-border/30 bg-workspace-surface/20 px-4 py-5 text-center mt-4">
                      <p className="text-sm text-workspace-text/80">Good morning. What would you like to focus on?</p>
                      <p className="mt-1.5 text-[11px] text-workspace-text-secondary/50">
                        Ask anything — I'll materialize the right views.
                      </p>
                      {suggestions.length > 0 && (
                        <div className="mt-4 flex flex-wrap justify-center gap-2">
                          {suggestions.slice(0, 4).map(s => (
                            <button
                              key={s.id}
                              onClick={() => trackAndProcess(s.query)}
                              className="rounded-full border border-workspace-border/50 bg-white/80 px-3 py-1.5 text-[11px] text-workspace-text transition-all active:scale-[0.96]"
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {promptHistory.map((entry, i) => (
                    <div key={entry.timestamp} className="space-y-2">
                      {/* User message */}
                      <div className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-workspace-accent/10 border border-workspace-accent/15 px-3.5 py-2.5">
                          <p className="text-sm text-workspace-text leading-relaxed">{entry.query}</p>
                        </div>
                      </div>
                      {/* Reasoning steps — readable but visually distinct */}
                      {entry.steps && entry.steps.length > 1 && (() => {
                        const responseNorm = (entry.response || '').trim().slice(0, 200);
                        const steps = entry.steps.filter((s, si) =>
                          si < entry.steps!.length - 1 || s.trim().slice(0, 200) !== responseNorm
                        );
                        return steps.map((step, si) => (
                          <div key={si} className="flex flex-col items-start gap-1">
                            <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-workspace-surface/20 border border-workspace-border/25 px-3.5 py-2 shadow-none">
                              <div className="text-[12px] leading-relaxed text-workspace-text-secondary">
                                <MarkdownRenderer content={step} />
                              </div>
                            </div>
                          </div>
                        ));
                      })()}
                      {/* Thinking strip + interject composer — only on the most-recent entry */}
                      {i === promptHistory.length - 1 && (
                        <div className="flex justify-start">
                          <div className="max-w-[92%] w-full space-y-1">
                            <ThinkingStrip />
                            <InterjectComposer />
                          </div>
                        </div>
                      )}
                      {/* Final response */}
                      {entry.response && (
                        <div className="flex flex-col items-start gap-1">
                          <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-white border border-workspace-border/40 px-3.5 py-2.5 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                            <MarkdownRenderer content={entry.response} />
                          </div>
                        </div>
                      )}
                      {entry.error && (
                        <div className="flex justify-start">
                          <div className="max-w-[92%] w-full">
                            <ErrorTray
                              error={entry.error}
                              onRetry={() => trackAndProcess(entry.query, entry.images)}
                              onEdit={() => setInput(entry.query)}
                            />
                          </div>
                        </div>
                      )}
                      {/* Processing indicator — minimal in-thread hint (main animation is above input) */}
                      {i === promptHistory.length - 1 && !entry.response && isProcessing && (
                        <div className="flex justify-start">
                          <div className="rounded-2xl rounded-bl-md bg-white/60 border border-workspace-accent/20 px-3 py-1.5">
                            <span className="text-[10px] text-workspace-accent/50">{processingStatus || 'Working on it...'}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  <div ref={chatEndRef} />
                </div>
              </div>

              {/* Suggestions */}
              {suggestions.length > 0 && promptHistory.length > 0 && (
                <div className="border-t border-workspace-border/30 px-4 py-2 bg-workspace-surface/20">
                  <div className="flex gap-2 overflow-x-auto">
                    {suggestions.map(s => (
                      <button
                        key={s.id}
                        onClick={() => trackAndProcess(s.query)}
                        className="shrink-0 rounded-full border border-workspace-border/50 bg-white/80 px-2.5 py-1 text-[10px] text-workspace-text active:scale-[0.96]"
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Input area */}
              <div className="border-t border-workspace-border/50 bg-white/80 px-4 py-2.5 backdrop-blur-xl safe-area-bottom" onPaste={handlePaste}>
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleImageFiles(e.target.files)} />

                {/* Futuristic processing indicator — popup bar above input */}
                {isProcessing && (
                  <div
                    className="relative mb-2.5 overflow-hidden rounded-2xl border border-workspace-accent/30 bg-[linear-gradient(135deg,rgba(99,102,241,0.13),rgba(99,102,241,0.06),rgba(99,102,241,0.13))] px-3.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_12px_32px_rgba(99,102,241,0.20)] animate-[materialize_0.25s_cubic-bezier(0.16,1,0.3,1)_forwards]"
                    role="status"
                    aria-label="Sherpa is reasoning"
                  >
                    {/* Vertical scanline sweep */}
                    <div className="pointer-events-none absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-workspace-accent/55 to-transparent animate-[scanline_2s_linear_infinite]" />
                    {/* Data stream at bottom edge */}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-0.5 gap-px overflow-hidden rounded-b-2xl">
                      {Array.from({ length: 14 }).map((_, i) => (
                        <div
                          key={i}
                          className="flex-1 bg-workspace-accent/20 animate-[dataStream_2s_linear_infinite]"
                          style={{ animationDelay: `${i * 0.14}s` }}
                        />
                      ))}
                    </div>
                    <div className="relative flex items-center gap-2.5">
                      {/* Orbital spinner */}
                      <div className="relative h-6 w-6 shrink-0">
                        <div className="absolute inset-0 rounded-full border border-workspace-accent/30 animate-[spin_2.5s_linear_infinite]">
                          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-px h-1.5 w-1.5 rounded-full bg-workspace-accent" />
                        </div>
                        <div className="absolute inset-1 rounded-full border border-workspace-accent/15 animate-[spin_1.8s_linear_infinite_reverse]">
                          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-px h-1 w-1 rounded-full bg-workspace-accent/65" />
                        </div>
                        <div className="absolute inset-2 rounded-full bg-workspace-accent/20 animate-[pulse_1.5s_cubic-bezier(0.34,1.56,0.64,1)_infinite]" />
                      </div>
                      {/* Label + progress dots */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold tracking-wide text-workspace-accent">Reasoning</span>
                          <div className="flex items-center gap-1">
                            {[0, 1, 2, 3].map((j) => (
                              <div
                                key={j}
                                className="h-1 w-2.5 rounded-full bg-workspace-accent/45 animate-[progressDot_1.2s_cubic-bezier(0.34,1.56,0.64,1)_infinite]"
                                style={{ animationDelay: `${j * 0.15}s` }}
                              />
                            ))}
                          </div>
                        </div>
                        <p className="mt-0.5 text-[9px] leading-3 text-workspace-accent/65">
                          Sherpa is analyzing your workspace
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <VoiceIndicator volume={voice.volume} isListening={voice.isListening} />

                {pendingImages.length > 0 && (
                  <div className="flex gap-2 mb-2">
                    {pendingImages.map((src, idx) => (
                      <div key={idx} className="relative">
                        <img src={src} alt={`Image ${idx + 1}`} className="h-12 w-12 rounded-lg object-cover border border-workspace-border/50" />
                        <button
                          onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))}
                          className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-workspace-text/70 text-white text-[9px]"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 rounded-2xl border border-workspace-border/60 bg-white px-3 py-2 transition-all focus-within:border-workspace-accent/30">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }}
                    placeholder="Ask anything..."
                    className="flex-1 bg-transparent text-sm text-workspace-text placeholder:text-workspace-text-secondary/40 outline-none"
                    aria-label="Ask Sherpa"
                  />

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-full p-2 text-workspace-text-secondary/40 active:bg-workspace-accent/10"
                    title="Attach image"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
                    </svg>
                  </button>

                  {voice.isSupported && (
                    <button
                      onTouchStart={(e) => { e.preventDefault(); voice.startListening(); }}
                      onTouchEnd={() => voice.stopListening()}
                      onMouseDown={(e) => { e.preventDefault(); voice.startListening(); }}
                      onMouseUp={() => voice.stopListening()}
                      className={`rounded-full p-2 transition-all ${
                        voice.isListening
                          ? 'bg-workspace-accent/15 text-workspace-accent scale-110'
                          : 'text-workspace-text-secondary/40 active:bg-workspace-accent/10'
                      }`}
                      title="Hold to speak"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" x2="12" y1="19" y2="22" />
                      </svg>
                    </button>
                  )}

                  <button
                    onClick={handleSubmit}
                    disabled={(!input.trim() && pendingImages.length === 0) || isProcessing}
                    className="rounded-full bg-workspace-accent/10 px-3 py-1.5 text-[11px] font-medium text-workspace-accent transition-all active:scale-[0.95] disabled:opacity-40"
                  >
                    {isProcessing ? '...' : 'Send'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'cards' && <MobileCardStack />}

          {activeTab === 'context' && (
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
              <div className="space-y-0.5">
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/75">
                  Document Context
                </span>
                <p className="text-[11px] text-workspace-text-secondary">
                  Control which documents Sherpa considers.
                </p>
              </div>
              <DocumentContextSelector
                selectedDocIds={selectedDocIds}
                onSelectionChange={setSelectedDocIds}
                contextMode={contextMode}
                onModeChange={setContextMode}
                onOpenDocument={handleOpenDocument}
              />
              <QBOStatusPanel />
              <OutlookStatusPanel />
              <Notebook onSendToSherpa={trackAndProcess} />
            </div>
          )}

          {activeTab === 'log' && (
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/75">
                  AI Call Log
                </span>
              </div>
              <AITelemetryPanel />
            </div>
          )}

          {activeTab === 'admin' && adminUnlocked && (
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
              <div className="flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-workspace-accent animate-pulse" />
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/75">
                  Admin Controls
                </span>
              </div>

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

              <div>
                <label className="block text-[10px] text-workspace-text-secondary/60 mb-1.5">
                  Agent Iteration Cap: <span className="font-mono text-workspace-accent">{adminState.agentMaxIterations} loops</span>
                </label>
                <input
                  type="range"
                  min={3}
                  max={30}
                  step={1}
                  value={adminState.agentMaxIterations}
                  onChange={(e) => {
                    setAdminAgentMaxIterations(Number(e.target.value));
                    setAdminState(getAdminSettings());
                  }}
                  className="w-full h-1.5 rounded-full appearance-none bg-workspace-border/40 accent-workspace-accent cursor-pointer"
                />
                <div className="flex justify-between text-[8px] text-workspace-text-secondary/30 mt-1">
                  <span>3</span>
                  <span>30</span>
                </div>
                <p className="text-[9px] text-workspace-text-secondary/40 mt-1 leading-snug">
                  Max tool-calling rounds before Sherpa must respond. Morning briefs override to 12.
                </p>
              </div>

              <div className="pt-4 border-t border-workspace-border/30">
                <PromptEditor />
              </div>
            </div>
          )}

          <MobileTabBar activeTab={activeTab} onTabChange={setActiveTab} adminUnlocked={adminUnlocked} />
        </>
      )}
    </div>
  );
}
