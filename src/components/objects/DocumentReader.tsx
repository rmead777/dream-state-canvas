import { useState, useCallback, useEffect } from 'react';
import { WorkspaceObject } from '@/lib/workspace-types';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useDocuments } from '@/contexts/DocumentContext';
import { useAI } from '@/hooks/useAI';
import MarkdownRenderer from '@/components/objects/MarkdownRenderer';
import { buildDocumentObjectContext, resolveDocumentRecord } from '@/lib/document-store';
import { supabase } from '@/integrations/supabase/client';
import { PdfCanvasViewer } from '@/components/objects/PdfCanvasViewer';

interface DocumentReaderProps {
  object: WorkspaceObject;
  isImmersive?: boolean;
}

interface LegacyDocumentPayload {
  summary?: string;
  extractedText?: string;
  structuredInsights?: {
    sections?: string[];
  };
}

function splitIntoParagraphs(text: string): string[] {
  const normalized = text.replace(/\r/g, '').trim();
  if (!normalized) return [];

  const paragraphSplit = normalized
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (paragraphSplit.length >= 2) return paragraphSplit.slice(0, 120);

  return normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 120);
}

function stripMarkdownCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) return trimmed;

  const withoutOpeningFence = trimmed.replace(/^```[a-zA-Z0-9_-]*\s*/u, '');
  return withoutOpeningFence.replace(/\s*```$/u, '').trim();
}

function extractBalancedJsonObject(value: string): string | null {
  const start = value.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < value.length; i += 1) {
    const char = value[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, i + 1);
      }
    }
  }

  return null;
}

function parseLegacyDocumentPayload(value: string): LegacyDocumentPayload | null {
  const candidates = [value.trim(), stripMarkdownCodeFence(value)];

  for (const candidate of candidates) {
    if (!candidate) continue;

    try {
      return JSON.parse(candidate) as LegacyDocumentPayload;
    } catch {
      const extracted = extractBalancedJsonObject(candidate);
      if (!extracted) continue;

      try {
        return JSON.parse(extracted) as LegacyDocumentPayload;
      } catch {
        continue;
      }
    }
  }

  return null;
}

function normalizeLegacyDocumentContent(summary: string, paragraphs: string[]) {
  const raw = paragraphs.join('\n\n').trim();
  const parsed = parseLegacyDocumentPayload(raw);

  if (!parsed) {
    return {
      summary,
      paragraphs,
      hadLegacyPayload: false,
    };
  }

  const normalizedParagraphs = parsed.extractedText?.trim()
    ? splitIntoParagraphs(parsed.extractedText)
    : Array.isArray(parsed.structuredInsights?.sections)
      ? parsed.structuredInsights.sections.filter(Boolean)
      : [];

  return {
    summary: parsed.summary?.trim() || summary,
    paragraphs: normalizedParagraphs.length > 0 ? normalizedParagraphs : paragraphs,
    hadLegacyPayload: true,
  };
}

export function DocumentReader({ object, isImmersive = false }: DocumentReaderProps) {
  const { dispatch } = useWorkspace();
  const { documents } = useDocuments();
  const { streamChat, isStreaming } = useAI();
  const d = object.context;
  const [askInput, setAskInput] = useState('');
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<number[]>([]);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const normalizedContent = normalizeLegacyDocumentContent(d.summary || '', d.paragraphs || []);
  const paragraphs: string[] = normalizedContent.paragraphs;
  const summary: string = normalizedContent.summary;
  const fileName: string = d.fileName || object.title || 'Untitled Document';
  const fileType: string = d.fileType || '';
  const showAiResponsePanel = isStreaming || Boolean(aiResponse);

  const isPdf = fileType === 'pdf' || fileName.toLowerCase().endsWith('.pdf');

  // Load PDF URL from storage
  useEffect(() => {
    if (!isPdf || !isImmersive) return;

    const storagePath = d.storagePath;
    if (!storagePath) return;

    let cancelled = false;

    setPdfError(null);
    setPdfBlob(null);

    supabase.storage
      .from('documents')
      .download(storagePath)
      .then(({ data, error }) => {
        if (cancelled) return;

        if (error || !data) {
          setPdfError('Could not load the PDF file.');
          return;
        }

        setPdfBlob(data);
      });

    return () => {
      cancelled = true;
    };
  }, [isPdf, isImmersive, d.storagePath]);

  useEffect(() => {
    let cancelled = false;

    const hydrateDocumentContext = async () => {
      const resolved = await resolveDocumentRecord({
        title: object.title,
        query: object.origin.query,
        preferredIds: documents.map((doc) => doc.id),
      });

      if (!resolved || cancelled) return;

      const nextContext = buildDocumentObjectContext(resolved);
      const sourceChanged = d.sourceDocId !== nextContext.sourceDocId;
      const fileChanged = d.fileName !== nextContext.fileName;
      const typeChanged = d.fileType !== nextContext.fileType;
      const missingContent = !Array.isArray(d.paragraphs) || d.paragraphs.length === 0;
      const malformedContent = normalizedContent.hadLegacyPayload;

      if (sourceChanged || fileChanged || typeChanged || missingContent || malformedContent) {
        dispatch({
          type: 'UPDATE_OBJECT_CONTEXT',
          payload: {
            id: object.id,
            context: { ...d, ...nextContext },
          },
        });
      }
    };

    hydrateDocumentContext();

    return () => {
      cancelled = true;
    };
  }, [dispatch, documents, d, normalizedContent.hadLegacyPayload, object.id, object.origin.query, object.title]);

  const handleAsk = useCallback(async () => {
    if (!askInput.trim() || isStreaming) return;
    const question = askInput;
    setAskInput('');
    setAiResponse('');

    await streamChat(
      [
        {
          role: 'user',
          content: `Document: "${fileName}"\nType: ${fileType || 'unknown'}\n\nContent:\n${paragraphs.join('\n\n')}\n\nQuestion: ${question}`,
        },
      ],
      {
        mode: 'document',
        onDelta: (text) => setAiResponse((prev) => (prev || '') + text),
      }
    );
  }, [askInput, isStreaming, streamChat, fileName, fileType, paragraphs]);

  const toggleHighlight = (idx: number) => {
    setHighlights((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  const handleEnterImmersive = () => {
    dispatch({ type: 'ENTER_IMMERSIVE', payload: { id: object.id } });
  };

  if (!isImmersive) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-workspace-text-secondary text-xs">{fileType === 'pdf' ? '📄' : '📁'}</span>
            <span className="text-sm text-workspace-text truncate">{fileName}</span>
          </div>
          <button
            onClick={handleEnterImmersive}
            className="workspace-focus-ring rounded-full px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-workspace-accent transition-colors hover:bg-workspace-accent-subtle/30"
          >
            Open immersive →
          </button>
        </div>

        {summary && (
          <div className="rounded-lg bg-workspace-accent-subtle/20 px-3 py-2.5">
            <span className="text-[9px] font-medium uppercase tracking-widest text-workspace-accent/60 block mb-1">
              AI Summary
            </span>
            <p className="text-xs leading-relaxed text-workspace-text-secondary">{summary}</p>
          </div>
        )}

        {paragraphs.length > 0 ? (
          <p className="text-xs text-workspace-text-secondary/50 leading-relaxed line-clamp-3">
            {paragraphs[0]}
          </p>
        ) : (
          <div className="rounded-2xl border border-workspace-border/45 bg-workspace-surface/25 px-4 py-3 text-xs leading-6 text-workspace-text-secondary/70">
            This document hasn’t produced readable excerpt text yet. Open immersive mode once processing is complete.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 md:flex-row">
      {/* PDF Viewer — main area */}
      {isPdf ? (
        <div className="workspace-card-surface flex-1 min-w-0 min-h-[60vh] md:min-h-0 overflow-hidden rounded-[28px] border border-workspace-border/45 bg-workspace-surface">
          {pdfBlob ? (
            <PdfCanvasViewer fileBlob={pdfBlob} fileName={fileName} />
          ) : (
            <div className="flex h-full items-center justify-center px-6">
              <div className="workspace-card-surface max-w-sm rounded-[28px] border border-workspace-border/45 bg-workspace-bg px-6 py-5 text-center shadow-sm">
                <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.24em] text-workspace-accent">
                  {pdfError ? 'PDF unavailable' : 'Loading PDF'}
                </div>
                {pdfError ? (
                  <p className="text-sm leading-relaxed text-workspace-text-secondary">
                    {pdfError}
                  </p>
                ) : (
                  <div className="space-y-2" aria-hidden="true">
                    <div className="workspace-skeleton h-3 rounded-full" />
                    <div className="workspace-skeleton h-3 rounded-full" />
                    <div className="workspace-skeleton h-3 w-4/5 rounded-full mx-auto" />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="workspace-card-surface flex-1 min-w-0 overflow-y-auto rounded-[28px] border border-workspace-border/45 px-8 py-10">
          <div className="mx-auto max-w-3xl">
            <div className="mb-6 flex flex-wrap items-center gap-2">
              <span className="workspace-pill rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-workspace-accent/75">Document</span>
              <span className="workspace-pill rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-workspace-text-secondary/70 tabular-nums">{paragraphs.length} excerpts</span>
              {highlights.length > 0 && (
                <span className="workspace-pill rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-workspace-accent/75 tabular-nums">{highlights.length} highlighted</span>
              )}
            </div>
            {paragraphs.length > 0 ? (
              <div className="space-y-6">
                {paragraphs.map((para, idx) => (
                  <p
                    key={idx}
                    onClick={() => toggleHighlight(idx)}
                    className={`text-[15px] leading-[1.8] cursor-pointer transition-colors duration-200 rounded-md -mx-2 px-2 py-1 ${
                      highlights.includes(idx)
                        ? 'bg-workspace-accent/8 text-workspace-text'
                        : 'text-workspace-text-secondary hover:text-workspace-text'
                    }`}
                  >
                    {para}
                  </p>
                ))}
              </div>
            ) : (
              <div className="workspace-card-surface flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-[28px] border border-workspace-border/45 px-6 py-8 text-center">
                <span className="workspace-pill rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/75">
                  Document body
                </span>
                <p className="text-sm font-medium text-workspace-text">No readable excerpt text is available yet</p>
                <p className="max-w-[34ch] text-xs leading-5 text-workspace-text-secondary/75">
                  The document metadata is loaded, but extracted body text has not been materialized for this view.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Right sidebar (or bottom panel on mobile) — AI Summary + Ask */}
      <div className="workspace-card-surface w-full md:w-[380px] lg:w-[420px] md:shrink-0 overflow-y-auto rounded-[28px] border border-workspace-border/45 bg-workspace-bg">
        <div className="px-6 py-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-workspace-accent/70">Document brief</div>
              <h3 className="mt-1 text-sm font-semibold text-workspace-text">{fileName}</h3>
            </div>
            <span className="workspace-pill rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-workspace-text-secondary/70">
              {fileType || 'file'}
            </span>
          </div>

          {summary && (
            <div className="rounded-2xl bg-workspace-accent-subtle/15 border border-workspace-accent/10 px-5 py-4 shadow-[0_16px_36px_rgba(99,102,241,0.08)]">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-workspace-accent text-sm">✦</span>
                <span className="text-[10px] font-medium uppercase tracking-widest text-workspace-accent">
                  AI Summary
                </span>
              </div>
              <p className="text-sm leading-relaxed text-workspace-text">{summary}</p>
            </div>
          )}

          {/* Ask panel */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-workspace-accent text-sm">✦</span>
              <span className="text-xs font-medium text-workspace-text">Ask about this document</span>
            </div>

            <div className="workspace-card-surface flex items-center gap-2 rounded-2xl border border-workspace-border/55 px-4 py-3 transition-all duration-200 workspace-spring focus-within:border-workspace-accent/30 focus-within:shadow-[0_14px_32px_rgba(99,102,241,0.12)]">
              <input
                type="text"
                value={askInput}
                onChange={(e) => setAskInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
                aria-label="Ask a question about this document"
                aria-describedby={`document-ask-hint-${object.id}`}
                placeholder="What are the key risks mentioned?"
                className="flex-1 bg-transparent text-sm text-workspace-text placeholder:text-workspace-text-secondary/40 outline-none"
              />
              <button
                onClick={handleAsk}
                disabled={isStreaming}
                className="workspace-focus-ring rounded-full bg-workspace-accent/10 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-workspace-accent transition-colors hover:bg-workspace-accent/20 disabled:opacity-50"
              >
                {isStreaming ? 'Reading…' : 'Ask'}
              </button>
            </div>

            <p id={`document-ask-hint-${object.id}`} className="mt-2 text-[11px] leading-5 text-workspace-text-secondary/60">
              Ask for risks, commitments, names, or supporting evidence. Press Enter to send.
            </p>

            {showAiResponsePanel && (
              <div role="status" aria-live="polite" className="mt-4 animate-[materialize_0.3s_cubic-bezier(0.16,1,0.3,1)_forwards] rounded-2xl bg-workspace-surface/60 px-5 py-4 border border-workspace-border/35">
                <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.22em] text-workspace-accent/70">
                  {isStreaming && !aiResponse ? 'Preparing answer' : 'AI answer'}
                </div>
                {aiResponse ? (
                  <MarkdownRenderer content={aiResponse} isStreaming={isStreaming} />
                ) : (
                  <div className="space-y-2" aria-hidden="true">
                    <div className="workspace-skeleton h-3 rounded-full" />
                    <div className="workspace-skeleton h-3 rounded-full" />
                    <div className="workspace-skeleton h-3 w-4/5 rounded-full" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
