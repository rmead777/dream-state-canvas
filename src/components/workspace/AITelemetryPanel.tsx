/**
 * AITelemetryPanel — displays AI model call log with auth mode info.
 * Shows model, duration, auth mode (oauth/api_key/gateway), and fallback status.
 * Click any entry to expand and see the full raw API call payload.
 */
import { useState, useEffect } from 'react';
import { getAITelemetryEvents, clearAITelemetry, type AICallEvent, type AuthMode } from '@/lib/ai-telemetry';

const AUTH_CONFIG: Record<AuthMode, { label: string; detail: string; color: string; bg: string }> = {
  oauth:             { label: 'Subscription', detail: 'OAuth token', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200/50' },
  api_key:           { label: 'API Key',      detail: 'Paid',        color: 'text-amber-600',   bg: 'bg-amber-50 border-amber-200/50' },
  api_key_fallback:  { label: 'API Key',      detail: 'OAuth failed, paid fallback', color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200/50' },
  oauth_failed:      { label: 'Failed',       detail: 'OAuth failed, no API key',    color: 'text-red-600',    bg: 'bg-red-50 border-red-200/50' },
  gateway:           { label: 'Gateway',      detail: 'Lovable/Google', color: 'text-blue-600',  bg: 'bg-blue-50 border-blue-200/50' },
  unknown:           { label: 'Unknown',      detail: 'No telemetry', color: 'text-workspace-text-secondary', bg: 'bg-workspace-surface/30 border-workspace-border/30' },
};

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: 'text-orange-600',
  google: 'text-blue-600',
  openai: 'text-emerald-700',
  xai: 'text-purple-600',
};

function formatPayloadSection(key: string, value: unknown): string {
  if (key === 'messages' && Array.isArray(value)) {
    return value.map((m: any) => {
      const role = m.role?.toUpperCase() ?? 'UNKNOWN';
      const content = typeof m.content === 'string'
        ? m.content
        : JSON.stringify(m.content, null, 2);
      return `[${role}]\n${content}`;
    }).join('\n\n---\n\n');
  }
  if (key === 'tools' && Array.isArray(value)) {
    return value.map((t: any) => {
      const name = t.function?.name ?? t.name ?? '?';
      const desc = t.function?.description ?? t.description ?? '';
      return `• ${name}: ${desc}`;
    }).join('\n');
  }
  return JSON.stringify(value, null, 2);
}

function PayloadViewer({ payload }: { payload: Record<string, unknown> }) {
  const [activeSection, setActiveSection] = useState<string | null>('messages');

  // Priority order for sections
  const SECTION_ORDER = ['messages', 'tools', 'mode', 'adminModel', 'adminMaxTokens', 'documentIds', 'memories', 'promptOverride'];
  const keys = [
    ...SECTION_ORDER.filter(k => k in payload),
    ...Object.keys(payload).filter(k => !SECTION_ORDER.includes(k) && k !== 'stream'),
  ];

  const sectionLabels: Record<string, string> = {
    messages: 'Messages',
    tools: 'Tools',
    mode: 'Mode',
    adminModel: 'Model',
    adminMaxTokens: 'Max Tokens',
    documentIds: 'Documents',
    memories: 'Memories',
    promptOverride: 'Prompt Override',
  };

  return (
    <div className="mt-2 rounded-lg overflow-hidden border border-workspace-border/20">
      {/* Section tabs */}
      <div className="flex gap-0 border-b border-workspace-border/20 bg-slate-900/80 overflow-x-auto">
        {keys.map(key => (
          <button
            key={key}
            onClick={e => { e.stopPropagation(); setActiveSection(activeSection === key ? null : key); }}
            className={`px-2.5 py-1.5 text-[9px] font-medium uppercase tracking-wider whitespace-nowrap transition-colors ${
              activeSection === key
                ? 'bg-workspace-accent/20 text-workspace-accent border-b-2 border-workspace-accent'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {sectionLabels[key] ?? key}
            {key === 'messages' && Array.isArray(payload[key]) && (
              <span className="ml-1 opacity-50">({(payload[key] as any[]).length})</span>
            )}
            {key === 'tools' && Array.isArray(payload[key]) && (
              <span className="ml-1 opacity-50">({(payload[key] as any[]).length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Section content */}
      {activeSection && activeSection in payload && (
        <div className="bg-slate-950/90 p-3 max-h-80 overflow-y-auto" onClick={e => e.stopPropagation()}>
          <pre className="text-[10px] font-mono text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
            {formatPayloadSection(activeSection, payload[activeSection])}
          </pre>
        </div>
      )}
    </div>
  );
}

export function AITelemetryPanel() {
  const [events, setEvents] = useState<AICallEvent[]>(getAITelemetryEvents());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const handler = () => setEvents([...getAITelemetryEvents()]);
    window.addEventListener('ai-telemetry', handler);
    window.addEventListener('ai-telemetry-clear', handler);
    return () => {
      window.removeEventListener('ai-telemetry', handler);
      window.removeEventListener('ai-telemetry-clear', handler);
    };
  }, []);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <span className="text-workspace-text-secondary/40 text-sm">No AI calls yet</span>
        <span className="text-workspace-text-secondary/30 text-xs mt-1">Events appear as you interact with Sherpa</span>
      </div>
    );
  }

  const totalCalls = events.length;
  const oauthCalls = events.filter(e => e.authMode === 'oauth').length;
  const paidCalls = events.filter(e => e.authMode === 'api_key' || e.authMode === 'api_key_fallback').length;
  const avgDuration = events.reduce((sum, e) => sum + e.durationMs, 0) / events.length;
  const totalInputTokens = events.reduce((sum, e) => sum + (e.inputTokens || 0), 0);
  const totalOutputTokens = events.reduce((sum, e) => sum + (e.outputTokens || 0), 0);
  const totalTokens = totalInputTokens + totalOutputTokens;

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-1.5">
        <div className="rounded-lg border border-workspace-border/30 bg-workspace-surface/20 px-2 py-2 text-center">
          <div className="text-sm font-semibold text-workspace-text tabular-nums">{totalCalls}</div>
          <div className="text-[9px] text-workspace-text-secondary/50 uppercase tracking-wider">Calls</div>
        </div>
        <div className="rounded-lg border border-workspace-border/30 bg-workspace-surface/20 px-2 py-2 text-center">
          <div className="text-sm font-semibold text-workspace-text tabular-nums">{(avgDuration / 1000).toFixed(1)}s</div>
          <div className="text-[9px] text-workspace-text-secondary/50 uppercase tracking-wider">Avg</div>
        </div>
        <div className="rounded-lg border border-workspace-border/30 bg-workspace-surface/20 px-2 py-2 text-center">
          <div className="text-sm font-semibold text-workspace-accent tabular-nums">
            {totalTokens > 0 ? (totalTokens > 999999 ? `${(totalTokens / 1000000).toFixed(1)}M` : totalTokens > 999 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens) : '—'}
          </div>
          <div className="text-[9px] text-workspace-text-secondary/50 uppercase tracking-wider">Tokens</div>
        </div>
        <div className="rounded-lg border border-workspace-border/30 bg-workspace-surface/20 px-2 py-2 text-center">
          {oauthCalls > 0 ? (
            <>
              <div className="text-sm font-semibold text-emerald-600 tabular-nums">{oauthCalls}/{totalCalls}</div>
              <div className="text-[9px] text-emerald-600/60 uppercase tracking-wider">Sub</div>
            </>
          ) : paidCalls > 0 ? (
            <>
              <div className="text-sm font-semibold text-amber-600 tabular-nums">{paidCalls}</div>
              <div className="text-[9px] text-amber-600/60 uppercase tracking-wider">Paid</div>
            </>
          ) : (
            <>
              <div className="text-sm font-semibold text-workspace-text-secondary tabular-nums">—</div>
              <div className="text-[9px] text-workspace-text-secondary/50 uppercase tracking-wider">Auth</div>
            </>
          )}
        </div>
      </div>

      {/* Clear button */}
      <div className="flex justify-end">
        <button
          onClick={() => clearAITelemetry()}
          className="text-[10px] text-workspace-text-secondary/40 hover:text-workspace-text-secondary transition-colors"
        >
          Clear log
        </button>
      </div>

      {/* Event list */}
      <div className="space-y-1.5">
        {events.map((event) => {
          const auth = AUTH_CONFIG[event.authMode] || AUTH_CONFIG.unknown;
          const time = new Date(event.timestamp).toLocaleTimeString('en-US', { hour12: false });
          const modelShort = event.model.split('/').pop() || event.model;
          const providerColor = PROVIDER_COLORS[event.provider] || 'text-workspace-text-secondary';
          const isExpanded = expandedId === event.id;

          return (
            <div
              key={event.id}
              className={`rounded-lg border transition-colors cursor-pointer select-none ${
                isExpanded
                  ? 'border-workspace-accent/30 bg-slate-900/95'
                  : 'border-workspace-border/30 bg-white/60 hover:bg-workspace-surface/30'
              }`}
              onClick={() => setExpandedId(isExpanded ? null : event.id)}
            >
              <div className="px-3 py-2">
                {/* Row 1: timestamp + model + expand chevron + duration */}
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-[10px] text-workspace-text-secondary/40 tabular-nums shrink-0">{time}</span>
                  <span className={`text-[11px] font-semibold truncate ${providerColor}`}>{modelShort}</span>
                  <span className="ml-auto flex items-center gap-1.5">
                    <span className="font-mono text-[10px] text-workspace-text-secondary/50 tabular-nums shrink-0">
                      {(event.durationMs / 1000).toFixed(1)}s
                    </span>
                    <svg
                      className={`w-3 h-3 text-workspace-text-secondary/30 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                </div>
                {/* Row 2: tokens + auth badge */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(event.inputTokens || event.outputTokens) ? (
                    <span className="font-mono text-[9px] text-workspace-accent/70 tabular-nums">
                      {event.inputTokens?.toLocaleString() || '?'}→{event.outputTokens?.toLocaleString() || '?'}
                    </span>
                  ) : null}
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-medium ${auth.bg} ${auth.color}`}>
                    {auth.label}
                  </span>
                  {event.fallback && (
                    <span className="inline-flex items-center rounded-full border border-amber-200/50 bg-amber-50 px-2 py-0.5 text-[9px] font-medium text-amber-600">
                      Fallback
                    </span>
                  )}
                  {event.toolCalls !== undefined && event.toolCalls > 0 && (
                    <span className="text-[9px] text-workspace-accent/50">+ tools</span>
                  )}
                  {event.requestPayload && (
                    <span className="ml-auto text-[9px] text-workspace-text-secondary/30">
                      {isExpanded ? 'collapse' : 'expand payload'}
                    </span>
                  )}
                </div>
              </div>

              {/* Expanded payload viewer */}
              {isExpanded && event.requestPayload && (
                <div className="px-3 pb-3">
                  <PayloadViewer payload={event.requestPayload} />
                </div>
              )}
              {isExpanded && !event.requestPayload && (
                <div className="px-3 pb-3">
                  <div className="rounded-lg bg-slate-900/80 px-3 py-2 text-[10px] text-slate-400 font-mono">
                    No payload captured for this call
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
