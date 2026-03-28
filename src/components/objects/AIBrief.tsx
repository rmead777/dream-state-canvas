import { useState } from 'react';
import { WorkspaceObject } from '@/lib/workspace-types';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { FusionDataVisuals } from './FusionTable';
import { SYNTHESIS_LABELS, SynthesisType } from '@/lib/fusion-rules';
import { ChevronDown, ChevronRight, Undo2, Eye } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';

/** Compact preview of a source object's data for drillback */
function SourceDrillback({ object }: { object: WorkspaceObject }) {
  const ctx = object.context;

  return (
    <div className="rounded-lg border border-workspace-border/30 bg-workspace-surface/20 p-3 space-y-2 text-xs">
      <div className="text-[10px] font-medium uppercase tracking-wider text-workspace-text-secondary">
        {object.type} — {object.title}
      </div>

      {/* Metric preview */}
      {ctx?.currentValue !== undefined && (
        <div className="flex items-center gap-3">
          <span className="text-lg font-light text-workspace-text">
            {ctx.currentValue}{ctx.unit || ''}
          </span>
          {ctx.change !== undefined && (
            <span className={`text-xs ${ctx.change > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {ctx.change > 0 ? '+' : ''}{ctx.change}{ctx.unit || ''}
            </span>
          )}
        </div>
      )}

      {/* Table preview */}
      {ctx?.columns && ctx?.rows && (
        <div className="overflow-hidden rounded border border-workspace-border/20">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-workspace-surface/40">
                {ctx.columns.slice(0, 4).map((col: string) => (
                  <th key={col} className="px-2 py-1 text-left text-[10px] font-medium text-workspace-text-secondary">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ctx.rows.slice(0, 3).map((row: string[], i: number) => (
                <tr key={i} className="border-t border-workspace-border/10">
                  {row.slice(0, 4).map((cell: string, j: number) => (
                    <td key={j} className="px-2 py-1 text-workspace-text-secondary">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {ctx.rows.length > 3 && (
            <div className="px-2 py-1 text-[10px] text-workspace-text-secondary/50 bg-workspace-surface/20">
              +{ctx.rows.length - 3} more rows
            </div>
          )}
        </div>
      )}

      {/* Entity list preview */}
      {ctx?.entities?.length > 0 && !ctx?.columns && (
        <div className="space-y-1">
          {ctx.entities.slice(0, 3).map((e: any, i: number) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-workspace-text">{e.name}</span>
              {e.metrics && Object.entries(e.metrics).slice(0, 2).map(([k, v]) => (
                <span key={k} className="text-workspace-text-secondary">{k}: {String(v)}</span>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Document preview */}
      {ctx?.content && !ctx?.currentValue && !ctx?.columns && !ctx?.entities && (
        <p className="text-workspace-text-secondary line-clamp-3 leading-relaxed">
          {typeof ctx.content === 'string' ? ctx.content.slice(0, 200) : ''}
        </p>
      )}
    </div>
  );
}

export function AIBrief({ object }: { object: WorkspaceObject }) {
  const { state, dispatch } = useWorkspace();
  const d = object.context;
  const text = d.content || d.summary || '';
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [tableCollapsed, setTableCollapsed] = useState(false);

  // Resolve source objects for fusion visuals
  const sourceObjects = (d.sourceObjects || [])
    .map((s: any) => s.id ? state.objects[s.id] : null)
    .filter(Boolean) as WorkspaceObject[];

  const synthesisType = d.synthesisType as SynthesisType | undefined;
  const synthesisLabel = synthesisType ? SYNTHESIS_LABELS[synthesisType] : null;

  const handleFocusSource = (id: string) => {
    dispatch({ type: 'FOCUS_OBJECT', payload: { id } });
  };

  const handleReopenSources = () => {
    for (const s of d.sourceObjects || []) {
      if (s.id && state.objects[s.id]) {
        const obj = state.objects[s.id];
        if (obj.status === 'dissolved' || obj.status === 'collapsed') {
          dispatch({ type: 'RESTORE_OBJECT', payload: { id: s.id } });
        }
      }
    }
  };

  const handleUnfuse = () => {
    // Restore sources and dissolve this synthesis
    handleReopenSources();
    dispatch({ type: 'DISSOLVE_OBJECT', payload: { id: object.id } });
  };

  return (
    <div className="space-y-4">
      {/* Synthesis type badge + confidence */}
      {(synthesisLabel || d.confidence) && (
        <div className="flex items-center gap-3">
          {synthesisLabel && (
            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${synthesisLabel.color}`}>
              {synthesisLabel.label}
            </span>
          )}
          {d.confidence && (
            <div className="flex items-center gap-2 text-xs text-workspace-text-secondary">
              <div className="h-1.5 w-12 rounded-full bg-workspace-surface overflow-hidden">
                <div
                  className="h-full rounded-full bg-workspace-accent"
                  style={{ width: `${d.confidence * 100}%` }}
                />
              </div>
              <span>{Math.round(d.confidence * 100)}%</span>
            </div>
          )}
        </div>
      )}

      {/* Real data visualizations for fusion objects */}
      {sourceObjects.length > 0 && (
        <div className="animate-[materialize_0.5s_cubic-bezier(0.16,1,0.3,1)_forwards]">
          <button
            onClick={() => setTableCollapsed(!tableCollapsed)}
            className="flex items-center gap-2 w-full text-left mb-2 group"
          >
            {tableCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5 text-workspace-accent flex-shrink-0" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-workspace-accent flex-shrink-0" />
            )}
            <span className="text-[10px] font-medium uppercase tracking-wider text-workspace-text-secondary group-hover:text-workspace-text transition-colors">
              Data Table
            </span>
          </button>
          {!tableCollapsed && <FusionDataVisuals sources={sourceObjects} />}
        </div>
      )}

      {text && (
        <MarkdownRenderer content={text} />
      )}

      {d.insights && d.insights.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-medium uppercase tracking-wider text-workspace-text-secondary">
            Key Insights
          </div>
          {d.insights.map((insight: string, i: number) => (
            <div key={i} className="flex items-start gap-2 text-sm text-workspace-text-secondary leading-relaxed">
              <span className="text-workspace-accent mt-0.5 text-xs">✦</span>
              <span>{insight}</span>
            </div>
          ))}
        </div>
      )}

      {/* Ancestry — clickable source pills with drillback */}
      {d.sourceObjects && d.sourceObjects.length > 0 && (
        <div className="border-t border-workspace-border/50 pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-medium uppercase tracking-wider text-workspace-text-secondary">
              Synthesized From
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleReopenSources}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-workspace-text-secondary hover:bg-workspace-surface transition-colors"
                title="Reopen source objects"
              >
                <Eye className="h-3 w-3" />
                Reopen
              </button>
              <button
                onClick={handleUnfuse}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-red-500/70 hover:bg-red-50 transition-colors"
                title="Dissolve synthesis and restore sources"
              >
                <Undo2 className="h-3 w-3" />
                Unfuse
              </button>
            </div>
          </div>

          {/* Clickable source pills */}
          <div className="flex flex-wrap gap-1.5">
            {d.sourceObjects.map((s: any) => (
              <button
                key={s.id}
                onClick={() => handleFocusSource(s.id)}
                className="rounded-full bg-workspace-surface px-2.5 py-1 text-[11px] text-workspace-text-secondary hover:bg-workspace-accent/10 hover:text-workspace-accent transition-colors cursor-pointer"
              >
                {s.title}
              </button>
            ))}
          </div>

          {/* Drillback — expandable source context */}
          {sourceObjects.length > 0 && (
            <div className="space-y-1.5">
              {sourceObjects.map((srcObj) => (
                <div key={srcObj.id}>
                  <button
                    onClick={() => setExpandedSource(expandedSource === srcObj.id ? null : srcObj.id)}
                    className="flex items-center gap-1.5 text-[11px] text-workspace-text-secondary hover:text-workspace-text transition-colors w-full text-left"
                  >
                    {expandedSource === srcObj.id ? (
                      <ChevronDown className="h-3 w-3 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="h-3 w-3 flex-shrink-0" />
                    )}
                    <span className="truncate">Preview: {srcObj.title}</span>
                  </button>
                  {expandedSource === srcObj.id && (
                    <div className="mt-1.5 ml-4 animate-[materialize_0.2s_ease_forwards]">
                      <SourceDrillback object={srcObj} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {d.sources && d.sources.length > 0 && (
        <div className="border-t border-workspace-border/50 pt-3">
          <div className="text-[10px] font-medium uppercase tracking-wider text-workspace-text-secondary mb-1.5">
            Sources
          </div>
          <div className="flex flex-wrap gap-1.5">
            {d.sources.map((s: string) => (
              <span
                key={s}
                className="rounded-full bg-workspace-surface px-2.5 py-1 text-[11px] text-workspace-text-secondary"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
