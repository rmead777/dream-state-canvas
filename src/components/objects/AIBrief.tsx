import { WorkspaceObject } from '@/lib/workspace-types';

export function AIBrief({ object }: { object: WorkspaceObject }) {
  const d = object.context;
  const text = d.content || d.summary || '';

  return (
    <div className="space-y-4">
      {/* AI-generated fusion visual */}
      {d.fusionImage && (
        <div className="rounded-xl overflow-hidden border border-workspace-border/30 animate-[materialize_0.5s_cubic-bezier(0.16,1,0.3,1)_forwards]">
          <img
            src={d.fusionImage}
            alt="Synthesis visualization"
            className="w-full h-auto object-cover"
            style={{ maxHeight: 200 }}
          />
        </div>
      )}
      {d.generatingImage && !d.fusionImage && (
        <div className="rounded-xl border border-workspace-border/30 bg-workspace-surface/30 flex items-center justify-center h-32 animate-pulse">
          <div className="flex items-center gap-2 text-xs text-workspace-text-secondary/50">
            <div className="h-3 w-3 rounded-full border-2 border-workspace-accent/30 border-t-workspace-accent animate-spin" />
            <span>Generating visualization...</span>
          </div>
        </div>
      )}
      {d.confidence && (
        <div className="flex items-center gap-2 text-xs text-workspace-text-secondary">
          <div className="h-1.5 w-12 rounded-full bg-workspace-surface overflow-hidden">
            <div
              className="h-full rounded-full bg-workspace-accent"
              style={{ width: `${d.confidence * 100}%` }}
            />
          </div>
          <span>{Math.round(d.confidence * 100)}% confidence</span>
        </div>
      )}

      {text && (
        <div
          className="prose prose-sm max-w-none text-workspace-text-secondary leading-relaxed
            [&_strong]:text-workspace-text [&_strong]:font-medium
            [&_p]:mb-3 [&_p:last-child]:mb-0"
          dangerouslySetInnerHTML={{
            __html: text
              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
              .replace(/\n\n/g, '</p><p>')
              .replace(/^/, '<p>')
              .replace(/$/, '</p>'),
          }}
        />
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

      {d.sourceObjects && d.sourceObjects.length > 0 && (
        <div className="border-t border-workspace-border/50 pt-3">
          <div className="text-[10px] font-medium uppercase tracking-wider text-workspace-text-secondary mb-1.5">
            Synthesized From
          </div>
          <div className="flex flex-wrap gap-1.5">
            {d.sourceObjects.map((s: any) => (
              <span
                key={s.id}
                className="rounded-full bg-workspace-surface px-2.5 py-1 text-[11px] text-workspace-text-secondary"
              >
                {s.title}
              </span>
            ))}
          </div>
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
