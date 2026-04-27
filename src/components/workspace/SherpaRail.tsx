import { useState, useRef, useCallback, useEffect } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { useSherpa } from '@/contexts/SherpaContext';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { useAmbientAudio } from '@/hooks/useAmbientAudio';
import { useCognitiveMode } from '@/hooks/useCognitiveMode';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/useIsMobile';
import { MODE_LABELS } from '@/lib/cognitive-modes';
import { VoiceIndicator } from './VoiceIndicator';
import { DocumentContextSelector, ContextMode } from './DocumentContextSelector';
import { QBOStatusPanel } from './QBOStatusPanel';
import { RagicStatusPanel } from './RagicStatusPanel';
import { OutlookStatusPanel } from './OutlookStatusPanel';
import { useDocuments } from '@/contexts/DocumentContext';
import { invalidateProfileCache } from '@/lib/intent-engine';
import { clearProfileCache } from '@/lib/data-analyzer';
import {
  checkPassphrase, unlockAdmin, lockAdmin, isAdminUnlocked,
  getAdminSettings, setAdminModel, setAdminMaxTokens, setAdminContextWindow, AVAILABLE_MODELS,
} from '@/lib/admin-settings';
import { toast } from 'sonner';
import { PromptEditor } from './PromptEditor';
import { Notebook } from './Notebook';
import { ThinkingStrip } from './ThinkingStrip';
import { InterjectComposer } from './InterjectComposer';
import { ErrorTray } from './ErrorTray';
import { RulesEditor } from './RulesEditor';
import { AITelemetryPanel } from './AITelemetryPanel';
import { ShaderControlPanel } from './ShaderControlPanel';
import { ThreeDControlPanel } from './ThreeDControlPanel';
import { IngestControlPanel } from './IngestControlPanel';
import MarkdownRenderer from '../objects/MarkdownRenderer';
import { compressImage } from '@/lib/image-utils';
import { extractDataset } from '@/lib/document-store';
import { NEXT_MOVES_CATALOG, CATEGORY_LABELS, CATEGORY_ORDER, type NextMoveCategory } from '@/lib/next-moves-catalog';
import { loadFavorites, toggleFavorite } from '@/lib/next-moves-ranker';

const RAIL_MIN_WIDTH = 280;
const RAIL_MAX_WIDTH = 800;
const RAIL_DEFAULT_WIDTH = 440;
const RAIL_TABLET_DEFAULT = 280;
const RAIL_TABLET_MAX = 360;
const RAIL_WIDTH_KEY = 'sherpa-rail-width';

type RailTab = 'origin' | 'notebook' | 'rules' | 'context' | 'admin' | 'log';

const TAB_CONFIG: { id: RailTab; label: string; adminOnly?: boolean }[] = [
  { id: 'origin', label: 'Origin' },
  { id: 'notebook', label: 'Notebook' },
  { id: 'rules', label: 'Rules' },
  { id: 'context', label: 'Context' },
  { id: 'admin', label: 'Admin', adminOnly: true },
  { id: 'log', label: 'Log', adminOnly: true },
];

export function SherpaRail() {
  const { state, dispatch } = useWorkspace();
  const { processIntent, setDocumentIds } = useWorkspaceActions();
  const { suggestions, observations, lastResponse, processingStatus, isProcessing } = useSherpa();
  const cognitiveMode = useCognitiveMode();
  const { play } = useAmbientAudio();
  const { user, signOut } = useAuth();
  const { isTablet } = useIsMobile();
  const [input, setInput] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<RailTab>('origin');
  // Next Moves tray state — expanded shows all 25 grouped by category.
  const [showAllMoves, setShowAllMoves] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => loadFavorites());
  const handleToggleFavorite = useCallback((id: string) => {
    const next = toggleFavorite(id);
    setFavoriteIds(next);
    // Notify SherpaContext so suggestions immediately re-rank.
    window.dispatchEvent(new CustomEvent('sherpa-favorites-changed'));
  }, []);

  // Resizable width — narrower defaults on tablet
  const maxWidth = isTablet ? RAIL_TABLET_MAX : RAIL_MAX_WIDTH;
  const defaultWidth = isTablet ? RAIL_TABLET_DEFAULT : RAIL_DEFAULT_WIDTH;
  const [railWidth, setRailWidth] = useState(() => {
    try {
      const stored = localStorage.getItem(RAIL_WIDTH_KEY);
      return stored ? Math.max(RAIL_MIN_WIDTH, Math.min(maxWidth, parseInt(stored))) : defaultWidth;
    } catch { return defaultWidth; }
  });

  // Adjust width when switching between tablet and desktop
  useEffect(() => {
    if (isTablet && railWidth > RAIL_TABLET_MAX) {
      setRailWidth(RAIL_TABLET_DEFAULT);
    }
  }, [isTablet]);
  const isDraggingRef = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const startX = e.clientX;
    const startWidth = railWidth;

    let currentWidth = startWidth;

    const onMouseMove = (e: MouseEvent) => {
      const delta = startX - e.clientX;
      currentWidth = Math.max(RAIL_MIN_WIDTH, Math.min(maxWidth, startWidth + delta));
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
  }, [railWidth, maxWidth]);

  const [adminUnlocked, setAdminUnlocked] = useState(isAdminUnlocked());
  const [adminState, setAdminState] = useState(getAdminSettings());
  const [promptHistory, setPromptHistory] = useState<Array<{
    query: string;
    response: string | null;
    timestamp: number;
    steps?: string[];
    images?: string[];
    error?: { code: string; message: string; detail?: string };
  }>>([]);
  const [contextMode, setContextMode] = useState<ContextMode>('auto');
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownPanelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const { addDocument, documents } = useDocuments();

  const contextScopeLabel = contextMode === 'auto'
    ? `${documents.length} docs`
    : `${selectedDocIds.length} selected`;

  // Close model dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inToggle = modelDropdownRef.current?.contains(target);
      const inPanel = modelDropdownPanelRef.current?.contains(target);
      if (!inToggle && !inPanel) {
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

  const trackAndProcess = useCallback(async (text: string, images?: string[]) => {
    const ts = Date.now();
    setPromptHistory(prev => [...prev, { query: text, response: null, timestamp: ts, images }]);
    setActiveTab('origin');
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

  // Listen for tab-switch events from CommandPalette (e.g. /notebook)
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail;
      if (typeof tab === 'string' && ['origin', 'notebook', 'rules', 'context', 'admin', 'log'].includes(tab)) {
        setActiveTab(tab as RailTab);
        setIsExpanded(true);
      }
    };
    window.addEventListener('sherpa-switch-tab', handler);
    return () => window.removeEventListener('sherpa-switch-tab', handler);
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed && pendingImages.length === 0) return;

    // Check for admin passphrase (text-only)
    if (trimmed && checkPassphrase(trimmed)) {
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

    const images = pendingImages.length > 0 ? pendingImages : undefined;
    trackAndProcess(trimmed || 'What do you see in this image?', images);
    setInput('');
    setPendingImages([]);
  }, [input, pendingImages, trackAndProcess, adminUnlocked, dispatch]);

  // TTS state: track whether the last query came from voice, and whether TTS is active
  const lastWasVoiceRef = useRef(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  // Speak a response aloud via the Web Speech API
  const speakResponse = useCallback((text: string) => {
    if (!ttsSupported) return;
    window.speechSynthesis.cancel(); // cancel any in-progress speech
    // Strip markdown — the voice should hear clean prose
    const clean = text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/#{1,6}\s+/g, '')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')
      .trim();
    if (!clean) return;
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    utterance.volume = 0.95;
    // Prefer a natural English voice if available
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang.startsWith('en') && !v.name.includes('Google') && v.localService)
      || voices.find(v => v.lang.startsWith('en'));
    if (preferred) utterance.voice = preferred;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, [ttsSupported]);

  // Speak the response when a voice query gets a reply
  useEffect(() => {
    if (!lastWasVoiceRef.current) return;
    if (!lastResponse || isProcessing) return;
    lastWasVoiceRef.current = false;
    speakResponse(lastResponse);
  }, [lastResponse, isProcessing, speakResponse]);

  const handleVoiceResult = useCallback(
    (transcript: string) => {
      lastWasVoiceRef.current = true;
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
  const composerState = isSpeaking ? 'Speaking' : voice.isListening ? 'Listening' : isProcessing ? 'Reasoning' : input.trim() ? 'Ready to send' : 'Standing by';
  const composerStateTone = isSpeaking ? 'bg-violet-500' : voice.isListening ? 'bg-rose-500' : isProcessing ? 'bg-amber-500' : input.trim() ? 'bg-emerald-500' : 'bg-workspace-accent';

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    const compressed = await Promise.all(
      imageItems.map(item => compressImage(item.getAsFile()!))
    );
    setPendingImages(prev => [...prev, ...compressed]);
  }, []);

  const handleImageFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    const compressed = await Promise.all(imageFiles.map(compressImage));
    setPendingImages(prev => [...prev, ...compressed]);
  }, []);

  const handleSuggestionClick = (query: string) => {
    trackAndProcess(query);
  };

  const handleClearSherpaFull = useCallback(() => {
    dispatch({ type: 'CLEAR_SHERPA' });
    setPromptHistory([]);
    toast.success('Conversation cleared');
  }, [dispatch]);

  const handleOpenDocument = useCallback((doc: { id: string; filename: string; file_type: string; structured_data: any }) => {
    const isSpreadsheet = doc.file_type === 'xlsx' || doc.file_type === 'csv';
    const objectType = isSpreadsheet ? 'dataset' : 'document';

    // Check if a workspace object already exists for this document
    const existing = Object.values(state.objects).find(
      (o: any) => o.context?.sourceDocId === doc.id && o.status !== 'dissolved'
    );

    if (existing) {
      dispatch({ type: 'ENTER_IMMERSIVE', payload: { id: existing.id } });
      return;
    }

    // Materialize a new object and immediately enter immersive
    const objId = `doc-view-${doc.id.slice(0, 8)}-${Date.now()}`;
    // Extract columns/rows from the document's structured_data
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
    // Small delay to let reducer process, then enter immersive
    requestAnimationFrame(() => {
      dispatch({ type: 'ENTER_IMMERSIVE', payload: { id: objId } });
    });
  }, [state.objects, dispatch]);

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
          <button
            onClick={() => setIsExpanded(false)}
            className="flex h-6 w-6 items-center justify-center rounded-full text-xs text-workspace-text-secondary/40 hover:bg-workspace-surface/60 hover:text-workspace-text-secondary transition-colors shrink-0"
          >
            ▸
          </button>
        </div>

        {/* ═══ UTILITY TAB BAR ═══ */}
        <div className="flex items-center gap-0.5 -mb-px">
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
              {activeTab === tab.id && (
                <span className="absolute inset-x-1 bottom-0 h-[2px] rounded-full bg-workspace-accent" />
              )}
            </button>
          ))}

          {/* Model dropdown — next to tabs */}
          <div className="h-4 w-px bg-workspace-border/30 mx-1 shrink-0" />
          <div ref={modelDropdownRef} className="relative">
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
          </div>
        </div>
      </div>

      {/* Model dropdown panel */}
      {showModelDropdown && adminUnlocked && (
        <div ref={modelDropdownPanelRef} className="relative z-50 -mt-px">
          <div className="absolute left-4 top-0 w-56 max-h-[70vh] overflow-y-auto rounded-xl border border-workspace-border/45 bg-white shadow-[0_20px_60px_rgba(0,0,0,0.15)] animate-[materialize_0.15s_cubic-bezier(0.16,1,0.3,1)_forwards]">
          <div className="sticky top-0 z-10 bg-white border-b border-workspace-border/30 px-3 py-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-workspace-text-secondary/60">Switch Model</span>
          </div>
          {(['google', 'anthropic', 'xai', 'openai'] as const).map((provider) => {
            const providerModels = AVAILABLE_MODELS.filter(m => m.provider === provider);
            if (providerModels.length === 0) return null;
            const providerConfig: Record<string, { label: string; color: string; border: string }> = {
              google:    { label: 'Google',    color: 'text-blue-600',    border: 'border-blue-400' },
              anthropic: { label: 'Anthropic', color: 'text-orange-600',  border: 'border-orange-400' },
              xai:       { label: 'xAI',       color: 'text-purple-600',  border: 'border-purple-400' },
              openai:    { label: 'OpenAI',    color: 'text-emerald-600', border: 'border-emerald-400' },
            };
            const cfg = providerConfig[provider];
            return (
              <div key={provider} className="py-1">
                <div className={`mx-3 mt-1 mb-1 flex items-center gap-2`}>
                  <span className={`h-px flex-1 ${cfg.border}`} />
                  <span className={`text-[9px] uppercase tracking-wider font-semibold ${cfg.color}`}>
                    {cfg.label}
                  </span>
                  <span className={`h-px flex-1 ${cfg.border}`} />
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
                    className={`block w-full px-3 py-2 text-left text-[11px] transition-colors
                      ${adminState.model === m.id
                        ? 'bg-workspace-accent/5 text-workspace-accent font-medium'
                        : 'text-workspace-text hover:bg-workspace-surface/50'
                      }`}
                  >
                    <span className="font-medium">{m.label}</span>
                    <span className="block text-[9px] text-workspace-text-secondary/50 mt-0.5">{m.description}</span>
                    {adminState.model === m.id && (
                      <span className="text-[9px] text-workspace-accent/60 mt-0.5 block">Current</span>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
          </div>
        </div>
      )}

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
                <div className="space-y-3">
                  <div className="rounded-2xl border border-workspace-border/30 bg-workspace-surface/20 px-4 py-4 text-center">
                    <p className="text-sm text-workspace-text/80">Good morning. What would you like to focus on?</p>
                    <p className="mt-1.5 text-[11px] text-workspace-text-secondary/50">
                      Ask anything — I'll materialize the right views for you.
                    </p>
                  </div>
                  <button
                    onClick={() => trackAndProcess('Run my morning brief.')}
                    className="w-full rounded-xl border border-workspace-accent/20 bg-gradient-to-r from-workspace-accent/5 to-workspace-accent/10 px-4 py-3 text-left transition-all hover:border-workspace-accent/40 hover:shadow-[0_4px_16px_rgba(99,102,241,0.1)] group"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">☀️</span>
                      <div>
                        <p className="text-[12px] font-semibold text-workspace-text group-hover:text-workspace-accent transition-colors">Morning Brief</p>
                        <p className="text-[10px] text-workspace-text-secondary/50">Grade yesterday, surface what matters today, load the day</p>
                      </div>
                    </div>
                  </button>
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
                  {/* Reasoning steps — readable but visually distinct from final response */}
                  {entry.steps && entry.steps.length > 1 && (() => {
                    // Drop last step if it duplicates the response
                    const responseNorm = (entry.response || '').trim().slice(0, 200);
                    const steps = entry.steps.filter((s, si) =>
                      si < entry.steps!.length - 1 || s.trim().slice(0, 200) !== responseNorm
                    );
                    return steps.map((step, si) => (
                      <div key={si} className="flex flex-col items-start gap-1">
                        <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-workspace-surface/20 border border-workspace-border/25 px-3.5 py-2 shadow-none">
                          <div className="text-[12px] leading-relaxed text-workspace-text-secondary">
                            <MarkdownRenderer content={step} />
                          </div>
                        </div>
                      </div>
                    ));
                  })()}
                  {/* Final response */}
                  {/* Thinking strip + interject composer — renders the live agent
                      event timeline above each Sherpa response. Only on the
                      most-recent entry since both subscribe to the global
                      event stream which only carries one loop at a time. */}
                  {i === promptHistory.length - 1 && (
                    <div className="flex justify-start">
                      <div className="max-w-[90%] w-full space-y-1">
                        <ThinkingStrip />
                        <InterjectComposer />
                      </div>
                    </div>
                  )}
                  {entry.response && (
                    <div className="flex flex-col items-start gap-1">
                      <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-white border border-workspace-border/40 px-3.5 py-2.5 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                        <MarkdownRenderer content={entry.response} />
                      </div>
                    </div>
                  )}
                  {entry.error && (
                    <div className="flex justify-start">
                      <div className="max-w-[90%] w-full">
                        <ErrorTray
                          error={entry.error}
                          onRetry={() => trackAndProcess(entry.query, entry.images)}
                          onEdit={() => setInput(entry.query)}
                        />
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
                          <span className="text-[10px] text-workspace-accent/60">{processingStatus || 'Reasoning...'}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Proactive observations — disabled (was generating duplicates and noise) */}

              <div ref={chatEndRef} />
            </div>
          </div>

          {/* ═══ NEXT MOVES — curated library w/ expandable tray ═══ */}
          {suggestions.length > 0 && (
            <div className="relative z-10 border-t border-workspace-border/40 px-4 py-2.5 bg-workspace-surface/20">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-workspace-accent/55">
                  Next Moves
                </span>
                <button
                  onClick={() => setShowAllMoves((v) => !v)}
                  className="text-[9px] uppercase tracking-widest text-workspace-text-secondary/40 hover:text-workspace-accent transition-colors"
                  title={showAllMoves ? 'Collapse' : 'See all 25 prompts'}
                >
                  {showAllMoves ? '▾ hide' : '▸ more'}
                </button>
              </div>

              {/* Top 5 (ranked) */}
              {!showAllMoves && (
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s) => {
                    const isFav = favoriteIds.includes(s.id);
                    return (
                      <div key={s.id} className="group relative">
                        <button
                          onClick={() => handleSuggestionClick(s.query)}
                          className="rounded-full border border-workspace-border/50 bg-white/80 pl-2.5 pr-6 py-1
                            text-[10px] text-workspace-text transition-all duration-200
                            hover:border-workspace-accent/20 hover:bg-workspace-accent/5 hover:text-workspace-accent"
                        >
                          {s.label}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleFavorite(s.id); }}
                          className={`absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] leading-none transition-opacity ${
                            isFav ? 'text-amber-400 opacity-100' : 'text-workspace-text-secondary/30 opacity-0 group-hover:opacity-100 hover:text-amber-400'
                          }`}
                          title={isFav ? 'Unpin favorite' : 'Pin as favorite'}
                          aria-label={isFav ? 'Unpin favorite' : 'Pin as favorite'}
                        >
                          {isFav ? '★' : '☆'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Full catalog, grouped by category */}
              {showAllMoves && (
                <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                  {CATEGORY_ORDER.map((cat: NextMoveCategory) => {
                    const entries = NEXT_MOVES_CATALOG.filter((e) => e.category === cat);
                    if (entries.length === 0) return null;
                    return (
                      <div key={cat}>
                        <div className="text-[9px] uppercase tracking-widest text-workspace-text-secondary/50 mb-1">
                          {CATEGORY_LABELS[cat]}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {entries.map((entry) => {
                            const isFav = favoriteIds.includes(entry.id);
                            return (
                              <div key={entry.id} className="group relative">
                                <button
                                  onClick={() => { handleSuggestionClick(entry.query); setShowAllMoves(false); }}
                                  title={entry.description || entry.query}
                                  className="rounded-full border border-workspace-border/40 bg-white/60 pl-2.5 pr-6 py-1
                                    text-[10px] text-workspace-text transition-all duration-200
                                    hover:border-workspace-accent/20 hover:bg-workspace-accent/5 hover:text-workspace-accent"
                                >
                                  {entry.label}
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleToggleFavorite(entry.id); }}
                                  className={`absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] leading-none transition-opacity ${
                                    isFav ? 'text-amber-400 opacity-100' : 'text-workspace-text-secondary/30 opacity-0 group-hover:opacity-100 hover:text-amber-400'
                                  }`}
                                  title={isFav ? 'Unpin favorite' : 'Pin as favorite'}
                                  aria-label={isFav ? 'Unpin favorite' : 'Pin as favorite'}
                                >
                                  {isFav ? '★' : '☆'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ═══ INPUT AREA ═══ */}
          <div
            className="relative z-10 border-t border-workspace-border/50 bg-white/70 px-4 py-3 space-y-2 backdrop-blur-md"
            onPaste={handlePaste}
          >
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleImageFiles(e.target.files)}
            />
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

            {/* Image preview strip */}
            {pendingImages.length > 0 && (
              <div className="flex flex-wrap gap-2 px-1">
                {pendingImages.map((src, idx) => (
                  <div key={idx} className="relative group">
                    <img
                      src={src}
                      alt={`Image ${idx + 1}`}
                      className="h-16 w-16 rounded-lg object-cover border border-workspace-border/50 shadow-sm"
                    />
                    <button
                      onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))}
                      className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-workspace-text/70 text-white text-[9px] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive"
                      title="Remove image"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

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

              {/* Image upload button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className={`rounded-full p-1.5 transition-all duration-200 ${
                  pendingImages.length > 0
                    ? 'bg-workspace-accent/15 text-workspace-accent'
                    : 'text-workspace-text-secondary/40 hover:text-workspace-accent/60 hover:bg-workspace-accent/5'
                }`}
                title="Attach image (or paste)"
              >
                {pendingImages.length > 0 ? (
                  <span className="text-[9px] font-medium tabular-nums">{pendingImages.length}</span>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
                  </svg>
                )}
              </button>

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

              {/* Stop speaking button — only when TTS is active */}
              {isSpeaking && (
                <button
                  onClick={() => { window.speechSynthesis.cancel(); setIsSpeaking(false); }}
                  className="rounded-full p-1.5 bg-violet-100 text-violet-600 hover:bg-violet-200 transition-colors animate-pulse"
                  title="Stop speaking"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              )}

              {/* Clear conversation */}
              {(lastResponse || promptHistory.length > 0) && (
                <button
                  onClick={handleClearSherpaFull}
                  className="rounded-full p-1.5 text-workspace-text-secondary/30 hover:text-workspace-text-secondary/60 hover:bg-workspace-surface/50 transition-colors"
                  title="Clear conversation"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
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
              <span>Enter to send · Hold mic · Paste image</span>
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
          {activeTab === 'notebook' && <Notebook onSendToSherpa={trackAndProcess} />}

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
                onOpenDocument={handleOpenDocument}
              />
              <QBOStatusPanel />
              <RagicStatusPanel />
              <OutlookStatusPanel />
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

              {/* Shader Controls */}
              <div className="pt-4 border-t border-workspace-border/30">
                <ShaderControlPanel />
              </div>

              {/* 3D Scene Controls */}
              <div className="pt-4 border-t border-workspace-border/30">
                <ThreeDControlPanel />
              </div>

              {/* Document Ingestion Controls */}
              <div className="pt-4 border-t border-workspace-border/30">
                <IngestControlPanel />
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
