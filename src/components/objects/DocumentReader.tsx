import { useState, useCallback, useEffect } from 'react';
import { WorkspaceObject } from '@/lib/workspace-types';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useDocuments } from '@/contexts/DocumentContext';
import { useAI } from '@/hooks/useAI';
import MarkdownRenderer from '@/components/objects/MarkdownRenderer';
import { buildDocumentObjectContext, resolveDocumentRecord } from '@/lib/document-store';

interface DocumentReaderProps {
  object: WorkspaceObject;
  isImmersive?: boolean;
}

export function DocumentReader({ object, isImmersive = false }: DocumentReaderProps) {
  const { dispatch } = useWorkspace();
  const { documents } = useDocuments();
  const { streamChat, isStreaming } = useAI();
  const d = object.context;
  const [askInput, setAskInput] = useState('');
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<number[]>([]);

  const paragraphs: string[] = d.paragraphs || [];
  const summary: string = d.summary || '';
  const fileName: string = d.fileName || object.title || 'Untitled Document';
  const fileType: string = d.fileType || '';

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

      if (sourceChanged || fileChanged || typeChanged || missingContent) {
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
  }, [dispatch, documents, d, object.id, object.origin.query, object.title]);

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
            className="rounded-md px-2.5 py-1 text-[10px] text-workspace-accent transition-colors hover:bg-workspace-accent-subtle/30"
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

        <p className="text-xs text-workspace-text-secondary/50 leading-relaxed line-clamp-3">
          {paragraphs[0] || 'No content available.'}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      {summary && (
        <div className="mb-8 rounded-xl bg-workspace-accent-subtle/15 border border-workspace-accent/10 px-6 py-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-workspace-accent text-sm">✦</span>
            <span className="text-[10px] font-medium uppercase tracking-widest text-workspace-accent">
              AI Summary
            </span>
          </div>
          <p className="text-sm leading-relaxed text-workspace-text">{summary}</p>
        </div>
      )}

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

      <div className="mt-12 border-t border-workspace-border/30 pt-8">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-workspace-accent text-sm">✦</span>
          <span className="text-xs font-medium text-workspace-text">Ask about this document</span>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-workspace-border bg-white px-4 py-3 transition-all focus-within:border-workspace-accent/30 focus-within:shadow-sm">
          <input
            type="text"
            value={askInput}
            onChange={(e) => setAskInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
            placeholder="What are the key risks mentioned?"
            className="flex-1 bg-transparent text-sm text-workspace-text placeholder:text-workspace-text-secondary/40 outline-none"
          />
          <button
            onClick={handleAsk}
            disabled={isStreaming}
            className="rounded-lg bg-workspace-accent/10 px-3 py-1.5 text-xs text-workspace-accent transition-colors hover:bg-workspace-accent/20 disabled:opacity-50"
          >
            {isStreaming ? '...' : 'Ask'}
          </button>
        </div>

        {aiResponse && (
          <div className="mt-4 animate-[materialize_0.3s_cubic-bezier(0.16,1,0.3,1)_forwards] rounded-xl bg-workspace-surface/60 px-5 py-4">
            <MarkdownRenderer content={aiResponse} isStreaming={isStreaming} />
          </div>
        )}
      </div>
    </div>
  );
}
