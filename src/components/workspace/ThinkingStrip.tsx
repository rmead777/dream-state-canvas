/**
 * ThinkingStrip — slim ribbon that exposes Sherpa's reasoning live.
 *
 * Subscribes to the agent's AgentLoopEvent stream via useAgentEvents()
 * and renders each meaningful step (iteration, tool execution, scaffold
 * spawn) as a row in a vertical timeline.
 *
 * During execution: full timeline with pulsing dot on active step.
 * After completion: collapses to a one-line summary that the user can
 * expand by clicking. Empty during idle.
 */
import { useState, useMemo } from 'react';
import { useAgentEvents } from '@/hooks/useAgentEvents';
import { getToolStatus } from '@/lib/sherpa-tools';
import type { AgentLoopEvent } from '@/lib/manifestation-types';

// ─── Display Row Builder ────────────────────────────────────────────────────

interface DisplayRow {
  key: string;
  iteration: number | null;
  label: string;
  detail?: string;
  state: 'pending' | 'active' | 'done' | 'error';
  kind: 'iteration' | 'tool' | 'scaffold' | 'system';
}

function buildDisplayRows(events: AgentLoopEvent[], isLive: boolean): DisplayRow[] {
  const rows: DisplayRow[] = [];
  let currentIteration = 0;
  // Track active tool by name so completion can flip its state
  const activeToolKeys: Map<string, string> = new Map();

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    switch (ev.type) {
      case 'loop_start':
        // Skip — implied by the strip's existence
        break;
      case 'iteration_start':
        currentIteration = ev.iteration;
        break;
      case 'tool_executing': {
        const key = `tool-${ev.t}-${ev.toolName}`;
        const detail = describeToolArgs(ev.toolName, ev.args);
        rows.push({
          key,
          iteration: currentIteration,
          label: getToolStatus(ev.toolName) || ev.toolName,
          detail,
          state: 'active',
          kind: 'tool',
        });
        activeToolKeys.set(ev.toolName, key);
        break;
      }
      case 'tool_complete': {
        const k = activeToolKeys.get(ev.toolName);
        if (k) {
          const idx = rows.findIndex(r => r.key === k);
          if (idx >= 0) rows[idx] = { ...rows[idx], state: 'done' };
          activeToolKeys.delete(ev.toolName);
        }
        break;
      }
      case 'shadow_create':
        rows.push({
          key: `shadow-${ev.shadowId}`,
          iteration: currentIteration,
          label: `Materializing "${ev.title}"`,
          detail: ev.sourceObjectIds.length > 0 ? `from ${ev.sourceObjectIds.length} source${ev.sourceObjectIds.length > 1 ? 's' : ''}` : undefined,
          state: 'done',
          kind: 'scaffold',
        });
        break;
      case 'loop_complete':
      case 'loop_error':
        // Mark any still-active tool as errored if loop ended without complete
        for (const [, key] of activeToolKeys) {
          const idx = rows.findIndex(r => r.key === key);
          if (idx >= 0) rows[idx] = { ...rows[idx], state: ev.type === 'loop_error' ? 'error' : 'done' };
        }
        break;
      default:
        break;
    }
  }

  // If still live and no rows yet, show a "thinking" placeholder
  if (isLive && rows.length === 0) {
    rows.push({
      key: 'thinking',
      iteration: 1,
      label: 'Reading your question',
      state: 'active',
      kind: 'system',
    });
  }

  return rows;
}

/** Compact human-readable description of tool args for the strip. */
function describeToolArgs(toolName: string, args: Record<string, unknown>): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const keys = Object.keys(args);
  if (keys.length === 0) return undefined;

  // Per-tool shortcuts for the most common arg shapes
  if (toolName === 'queryDataset' && typeof args.documentId === 'string') {
    return `doc:${(args.documentId as string).slice(-6)}`;
  }
  if (toolName === 'queryQuickBooks' && typeof args.dataType === 'string') {
    return args.dataType as string;
  }
  if (toolName === 'queryEmails' && typeof args.query === 'string') {
    const q = args.query as string;
    return q.length > 24 ? q.slice(0, 24) + '…' : q;
  }
  if ((toolName === 'createCard' || toolName === 'updateCard') && typeof args.title === 'string') {
    const t = args.title as string;
    return t.length > 28 ? t.slice(0, 28) + '…' : t;
  }
  if (toolName === 'createScratchpad' && typeof args.name === 'string') {
    return args.name as string;
  }
  // Generic fallback — first scalar arg
  for (const k of keys) {
    const v = args[k];
    if (typeof v === 'string' && v.length > 0) {
      return v.length > 24 ? v.slice(0, 24) + '…' : v;
    }
    if (typeof v === 'number' || typeof v === 'boolean') {
      return `${k}:${String(v)}`;
    }
  }
  return undefined;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface RowDotProps {
  state: 'pending' | 'active' | 'done' | 'error';
  kind: 'iteration' | 'tool' | 'scaffold' | 'system';
}

function RowDot({ state, kind }: RowDotProps) {
  const baseSize = 'h-1.5 w-1.5 rounded-full shrink-0';
  if (state === 'active') {
    return <span className={`${baseSize} bg-workspace-accent animate-pulse shadow-[0_0_6px_rgba(99,102,241,0.6)]`} />;
  }
  if (state === 'error') {
    return <span className={`${baseSize} bg-rose-500/85`} />;
  }
  if (state === 'done') {
    if (kind === 'scaffold') {
      return <span className="text-emerald-500/70 text-[10px] leading-none -ml-0.5">✦</span>;
    }
    return <span className={`${baseSize} bg-emerald-500/65`} />;
  }
  return <span className={`${baseSize} bg-workspace-text-secondary/30`} />;
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface ThinkingStripProps {
  /** Force-collapsed mode for previously-completed messages. */
  forceCollapsed?: boolean;
}

export function ThinkingStrip({ forceCollapsed = false }: ThinkingStripProps) {
  const { events, isLive, startedAt, endedAt } = useAgentEvents();
  const [userExpanded, setUserExpanded] = useState(false);

  const rows = useMemo(() => buildDisplayRows(events, isLive), [events, isLive]);

  // Don't render anything when there's nothing to show
  if (events.length === 0 && !isLive) return null;

  // Compute summary stats
  const toolCount = rows.filter(r => r.kind === 'tool').length;
  const cardCount = rows.filter(r => r.kind === 'scaffold').length;
  const elapsedMs = startedAt && endedAt ? endedAt - startedAt : startedAt ? Date.now() - startedAt : 0;
  const elapsedSec = (elapsedMs / 1000).toFixed(1);

  // Auto-collapse after completion unless user expands
  const shouldCollapse = forceCollapsed || (!isLive && !userExpanded);

  if (shouldCollapse) {
    return (
      <button
        onClick={() => setUserExpanded(true)}
        className="group flex items-center gap-2 rounded-md border border-workspace-border/30 bg-workspace-surface/30 px-2.5 py-1 text-[10px] text-workspace-text-secondary/70 hover:border-workspace-accent/35 hover:text-workspace-accent transition-colors"
      >
        <span className="text-emerald-500/65 text-[8px]">●</span>
        <span className="tabular-nums">Reasoned {elapsedSec}s</span>
        {toolCount > 0 && (
          <>
            <span className="text-workspace-text-secondary/30">·</span>
            <span className="tabular-nums">{toolCount} {toolCount === 1 ? 'tool' : 'tools'}</span>
          </>
        )}
        {cardCount > 0 && (
          <>
            <span className="text-workspace-text-secondary/30">·</span>
            <span className="tabular-nums">{cardCount} {cardCount === 1 ? 'card' : 'cards'}</span>
          </>
        )}
        <span className="ml-1 text-[8px] opacity-0 group-hover:opacity-60 transition-opacity">▾</span>
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-workspace-border/30 bg-workspace-surface/25 px-3 py-2 animate-[materialize_0.32s_cubic-bezier(0.16,1,0.3,1)]">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${isLive ? 'bg-workspace-accent animate-pulse' : 'bg-emerald-500/65'}`} />
          <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-workspace-accent/70">
            {isLive ? 'Reasoning' : `Reasoned ${elapsedSec}s`}
          </span>
        </div>
        {!isLive && (
          <button
            onClick={() => setUserExpanded(false)}
            className="text-[9px] text-workspace-text-secondary/40 hover:text-workspace-text-secondary/80 transition-colors"
          >
            collapse
          </button>
        )}
      </div>

      {/* Vertical timeline */}
      <div className="relative pl-3">
        <div className="absolute left-[3px] top-1 bottom-1 w-px bg-workspace-border/40" />
        <div className="space-y-1">
          {rows.map((row, i) => (
            <div
              key={row.key}
              className="relative flex items-center gap-2 animate-[materialize_0.28s_cubic-bezier(0.16,1,0.3,1)]"
              style={{ animationDelay: i < 3 ? `${i * 40}ms` : '0ms' }}
            >
              <div className="absolute -left-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-2.5">
                <RowDot state={row.state} kind={row.kind} />
              </div>
              <div className="flex-1 min-w-0 flex items-baseline gap-2">
                <span className="text-[11px] text-workspace-text leading-tight truncate">
                  {row.label}
                </span>
                {row.detail && (
                  <span className="text-[9px] text-workspace-text-secondary/55 tabular-nums truncate">
                    {row.detail}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
