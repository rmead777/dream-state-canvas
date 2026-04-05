import { useWorkspace } from '@/contexts/WorkspaceContext';
import { DocumentReader } from '@/components/objects/DocumentReader';
import { DatasetView } from '@/components/objects/DatasetView';
import { AnalysisCard } from '@/components/objects/AnalysisCard';
import { MetricDetail } from '@/components/objects/MetricDetail';
import { ComparisonPanel } from '@/components/objects/ComparisonPanel';
import { AlertRiskPanel } from '@/components/objects/AlertRiskPanel';
import { AIBrief } from '@/components/objects/AIBrief';
import { Timeline } from '@/components/objects/Timeline';
import { DataInspector } from '@/components/objects/DataInspector';
import { DatasetEditPreview } from '@/components/objects/DatasetEditPreview';
import { MemoryCleanupPreview } from '@/components/objects/MemoryCleanupPreview';
import { getObjectTypeToken } from '@/lib/design-tokens';
import MarkdownRenderer from '@/components/objects/MarkdownRenderer';

/**
 * ImmersiveOverlay — full-screen expanded view for ANY card type.
 * Documents get the PDF viewer, datasets get the full table,
 * everything else renders its content in a spacious layout.
 */
export function ImmersiveOverlay() {
  const { state, dispatch } = useWorkspace();
  const { immersiveObjectId } = state.activeContext;

  if (!immersiveObjectId) return null;

  const object = state.objects[immersiveObjectId];
  if (!object || object.status === 'dissolved') return null;

  const handleClose = () => {
    dispatch({ type: 'EXIT_IMMERSIVE' });
  };

  const typeToken = getObjectTypeToken(object.type);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-[linear-gradient(to_bottom,rgba(255,255,255,0.96),rgba(248,248,252,0.96))] backdrop-blur-md animate-[immersive-enter_0.4s_cubic-bezier(0.16,1,0.3,1)_forwards]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(to_bottom,rgba(99,102,241,0.08),transparent)]" />

      {/* Minimal header — print shows title only */}
      <div className="relative z-10 flex items-center justify-between px-8 py-4 border-b border-workspace-border/30 backdrop-blur-sm print:border-b-2 print:border-gray-200 print:backdrop-blur-none print:px-0 print:py-2">
        <div className="flex items-center gap-3">
          <button
            onClick={handleClose}
            className="workspace-pill rounded-full px-3.5 py-2 text-xs text-workspace-text-secondary transition-all duration-200 workspace-spring hover:-translate-y-0.5 hover:text-workspace-text print:hidden"
          >
            ← Back to workspace
          </button>
          <div className="h-4 w-px bg-workspace-border/50 print:hidden" />
          <span className="workspace-pill rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent print:bg-transparent print:px-0">
            {typeToken.label}
          </span>
          <div>
            <h2 className="text-sm font-semibold text-workspace-text print:text-lg">{object.title}</h2>
            <p className="text-[11px] text-workspace-text-secondary/60 print:hidden">Expanded view</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="workspace-pill rounded-full px-3 py-1.5 text-[10px] text-workspace-text-secondary transition-colors hover:text-workspace-accent print:hidden"
            title="Export as PDF"
          >
            ↓ PDF
          </button>
          <button
            onClick={handleClose}
            className="workspace-pill rounded-full p-2 text-workspace-text-secondary transition-colors hover:text-workspace-text print:hidden"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Immersive content — full width for data, constrained for reading */}
      <div className={`relative z-10 flex-1 overflow-y-auto pt-6 pb-8 ${
        object.type === 'dataset' || object.type === 'inspector' || object.type === 'dataset-edit-preview' || object.type === 'memory-cleanup-preview' || object.context?.isDatasetEdit || object.context?.isMemoryCleanup ? 'px-4' : 'px-8'
      }`}>
        <div className={object.type === 'dataset' || object.type === 'inspector' || object.type === 'dataset-edit-preview' || object.type === 'memory-cleanup-preview' || object.context?.isDatasetEdit || object.context?.isMemoryCleanup ? '' : 'mx-auto max-w-4xl'}>
          <ImmersiveContent object={object} />
        </div>
      </div>
    </div>
  );
}

/** Render the appropriate content for any card type in immersive mode */
function ImmersiveContent({ object }: { object: any }) {
  // Source document cards always use their dedicated viewers — never bypass these with a sections check.
  // dataset → full virtualized table with hover detail bars, sort, filter, inline editing
  // document/document-viewer → native PDF canvas (PDFs) or full-text reader with AI sidebar
  switch (object.type) {
    case 'document':
    case 'document-viewer':
      return <DocumentReader object={object} isImmersive />;
    case 'dataset':
      return <DatasetView object={object} isImmersive />;
    case 'metric':
      return <MetricDetail object={object} />;
    case 'comparison':
      return <ComparisonPanel object={object} />;
    case 'alert':
      return <AlertRiskPanel object={object} />;
    case 'brief':
      if (object.context?.content) {
        return <MarkdownRenderer content={object.context.content} />;
      }
      return <AIBrief object={object} />;
    case 'timeline':
      return <Timeline object={object} />;
    case 'inspector':
      return <DataInspector object={object} />;
    case 'analysis':
      return <AnalysisCard object={object} />;
    case 'dataset-edit-preview':
      return <DatasetEditPreview object={object} />;
    case 'memory-cleanup-preview':
      return <MemoryCleanupPreview object={object} />;
    default:
      // Dataset edit preview (by flag, in case type doesn't match)
      if (object.context?.isDatasetEdit) {
        return <DatasetEditPreview object={object} />;
      }
      if (object.context?.isMemoryCleanup) {
        return <MemoryCleanupPreview object={object} />;
      }
      // Fallback: sections → AnalysisCard, content → Markdown, otherwise raw
      if (object.context?.sections?.length > 0) {
        return <AnalysisCard object={object} />;
      }
      if (object.context?.content) {
        return <MarkdownRenderer content={object.context.content} />;
      }
      return <AnalysisCard object={object} />;
  }
}
