/**
 * ProvenanceChips — footer row showing what Sherpa consulted to produce this card.
 *
 * Provenance is captured during the agent loop (sherpa-agent.ts) and attached
 * to create/update actions. Stored on `object.context.provenance`.
 *
 * Chip categories:
 *   - tool chips: each tool the agent called, with per-tool arg summary
 *   - source chips: distinct documents/scratchpads queried (names resolved
 *     from the document store via DocumentContext)
 *   - memory chip: count of memories injected into the system prompt
 *
 * Clicking a source chip pings the document store via DocumentContext.
 * Clicking the memory chip is a no-op for v1 — user can open the Notebook
 * tab to see the full memory list.
 */
import { useMemo } from 'react';
import { useDocuments } from '@/contexts/DocumentContext';

export interface Provenance {
  tools: Array<{ name: string; arg?: string }>;
  documentIds?: string[];
  memoryCount?: number;
}

interface ProvenanceChipsProps {
  provenance: Provenance;
  onSourceClick?: (documentId: string) => void;
}

// Tool category coloring — keep this minimal; the chip is identification, not decoration
function toolTone(name: string): string {
  if (name.startsWith('query') || name === 'searchData' || name === 'computeStats' || name === 'getCardData' || name === 'getDocumentContent') {
    return 'border-blue-300/45 bg-blue-50/45 text-blue-800/85';
  }
  if (name.startsWith('refresh') || name.startsWith('sync')) {
    return 'border-emerald-300/45 bg-emerald-50/45 text-emerald-800/85';
  }
  if (name === 'createCard' || name === 'updateCard' || name === 'editDataset' || name === 'createScratchpad') {
    return 'border-amber-300/45 bg-amber-50/45 text-amber-800/85';
  }
  if (name === 'rememberFact' || name === 'recallMemories') {
    return 'border-purple-300/45 bg-purple-50/45 text-purple-800/85';
  }
  return 'border-workspace-border/40 bg-workspace-surface/35 text-workspace-text-secondary';
}

// Compact label for the most verbose tool names
function toolLabel(name: string): string {
  switch (name) {
    case 'queryQuickBooks': return 'QuickBooks';
    case 'queryRagicOrders': return 'Ragic orders';
    case 'queryRagicCustomers': return 'Ragic customers';
    case 'queryEmails': return 'Emails';
    case 'queryDataset': return 'Dataset';
    case 'getDocumentContent': return 'Document';
    case 'getCardData': return 'Card';
    case 'computeStats': return 'Stats';
    case 'searchData': return 'Search';
    case 'createCard': return 'Card';
    case 'updateCard': return 'Update card';
    case 'editDataset': return 'Edit data';
    case 'createScratchpad': return 'Scratchpad';
    case 'rememberFact': return 'Memory';
    case 'recallMemories': return 'Recall';
    default: return name;
  }
}

export function ProvenanceChips({ provenance, onSourceClick }: ProvenanceChipsProps) {
  const { documents } = useDocuments();

  // Dedupe tool calls — show each distinct (name, arg) pair once
  const distinctTools = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ name: string; arg?: string }> = [];
    for (const t of provenance.tools || []) {
      const key = `${t.name}|${t.arg || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }, [provenance.tools]);

  const sources = useMemo(() => {
    if (!provenance.documentIds || provenance.documentIds.length === 0) return [];
    return provenance.documentIds.map(id => {
      const doc = documents.find(d => d.id === id);
      const meta = (doc?.metadata || {}) as { isScratchpad?: boolean; primarySheet?: string };
      const name = meta.primarySheet || doc?.filename?.replace(/\.scratchpad$/, '') || `doc:${id.slice(-6)}`;
      return { id, name, isScratchpad: Boolean(meta.isScratchpad) };
    });
  }, [provenance.documentIds, documents]);

  const totalChips = distinctTools.length + sources.length + (provenance.memoryCount && provenance.memoryCount > 0 ? 1 : 0);
  if (totalChips === 0) return null;

  return (
    <div className="mt-3 pt-2.5 border-t border-workspace-border/25">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[8px] font-medium uppercase tracking-[0.2em] text-workspace-text-secondary/55">
          Sources
        </span>
        <div className="h-px flex-1 bg-workspace-border/20" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sources.map(s => (
          <button
            key={s.id}
            onClick={() => onSourceClick?.(s.id)}
            className={`group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] transition-all hover:scale-[1.02] ${
              s.isScratchpad
                ? 'border-emerald-300/55 bg-emerald-50/60 text-emerald-800/90'
                : 'border-workspace-border/45 bg-workspace-surface/45 text-workspace-text-secondary'
            }`}
            title={s.isScratchpad ? `Scratchpad: ${s.name}` : `Document: ${s.name}`}
          >
            <span className="text-[7px] opacity-70">{s.isScratchpad ? '✦' : '◇'}</span>
            <span className="font-medium truncate max-w-[120px]">{s.name}</span>
          </button>
        ))}

        {distinctTools.map((t, i) => (
          <span
            key={`${t.name}-${i}`}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] ${toolTone(t.name)}`}
            title={t.arg ? `${t.name}(${t.arg})` : t.name}
          >
            <span className="font-medium">{toolLabel(t.name)}</span>
            {t.arg && <span className="opacity-65 truncate max-w-[80px]">·&nbsp;{t.arg}</span>}
          </span>
        ))}

        {provenance.memoryCount !== undefined && provenance.memoryCount > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-purple-300/45 bg-purple-50/45 px-2 py-0.5 text-[9px] text-purple-800/85"
            title={`${provenance.memoryCount} memor${provenance.memoryCount === 1 ? 'y' : 'ies'} applied from prior conversations`}
          >
            <span className="text-[7px] opacity-70">◆</span>
            <span className="font-medium tabular-nums">{provenance.memoryCount}</span>
            <span className="opacity-70">memor{provenance.memoryCount === 1 ? 'y' : 'ies'}</span>
          </span>
        )}
      </div>
    </div>
  );
}
