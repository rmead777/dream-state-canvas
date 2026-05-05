/**
 * AITelemetryPanel — displays AI model call log with auth mode info.
 * Shows model, duration, auth mode (oauth/api_key/gateway), and fallback status.
 * Click any entry to expand and see the full raw API call payload.
 */
import { useState, useEffect } from 'react';
import { getAITelemetryEvents, clearAITelemetry, type AICallEvent, type AuthMode, type RouteAttempt } from '@/lib/ai-telemetry';

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

const ATTEMPT_STATUS: Record<RouteAttempt['status'], { dot: string; label: string; text: string }> = {
  ok:      { dot: 'bg-emerald-500',  label: 'OK',      text: 'text-emerald-700' },
  error:   { dot: 'bg-red-500',      label: 'ERROR',   text: 'text-red-700' },
  skipped: { dot: 'bg-slate-400',    label: 'SKIPPED', text: 'text-slate-600' },
};

function RoutingTrace({ event }: { event: AICallEvent }) {
  const attempts = event.attempts ?? [];
  const finalAuth = AUTH_CONFIG[event.authMode] || AUTH_CONFIG.unknown;

  return (
    <div className="rounded-lg border border-workspace-border/30 bg-white/80 p-3 space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-workspace-text-secondary">API Routing</span>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-medium ${finalAuth.bg} ${finalAuth.color}`}>
          Resolved → {finalAuth.label}
        </span>
        {event.fallback && (
          <span className="inline-flex items-center rounded-full border border-amber-200/60 bg-amber-50 px-2 py-0.5 text-[9px] font-medium text-amber-700">
            Fallback fired
          </span>
        )}
      </div>

      {event.fallbackReason ? (
        <div className="rounded-md border border-amber-200/50 bg-amber-50/80 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900">
          <span className="font-semibold">Why fallback: </span>{event.fallbackReason}
        </div>
      ) : event.fallback ? (
        <div className="rounded-md border border-workspace-border/30 bg-workspace-surface/30 px-2.5 py-2 text-[11px] text-workspace-text-secondary">
          Fallback fired but no reason was captured (older edge function deployment).
        </div>
      ) : (
        <div className="text-[10px] text-workspace-text-secondary/60">
          Primary route succeeded — no fallback needed.
        </div>
      )}

      {attempts.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[9px] uppercase tracking-wider text-workspace-text-secondary/60">Attempt chain ({attempts.length})</div>
          <ol className="space-y-1">
            {attempts.map((a, i) => {
              const s = ATTEMPT_STATUS[a.status];
              return (
                <li key={i} className="rounded-md border border-workspace-border/20 bg-white/70 px-2.5 py-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[9px] text-workspace-text-secondary/50 tabular-nums w-4">{i + 1}.</span>
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${s.dot}`} />
                    <span className={`text-[10px] font-semibold ${s.text}`}>{s.label}</span>
                    <span className="text-[10px] font-mono text-workspace-text">
                      {a.provider}/{a.model.split('/').pop()}
                    </span>
                    <span className="text-[9px] text-workspace-text-secondary/60">via {a.authMode}</span>
                    {typeof a.httpStatus === 'number' && (
                      <span className={`text-[9px] font-mono ${a.status === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>
                        HTTP {a.httpStatus}
                      </span>
                    )}
                    {typeof a.retry === 'number' && a.retry > 0 && (
                      <span className="text-[9px] text-amber-700">retry #{a.retry}</span>
                    )}
                    {typeof a.durationMs === 'number' && (
                      <span className="ml-auto text-[9px] font-mono text-workspace-text-secondary/50 tabular-nums">
                        {(a.durationMs / 1000).toFixed(2)}s
                      </span>
                    )}
                  </div>
                  {a.reason && (
                    <div className="mt-1 pl-6 text-[10px] text-workspace-text-secondary leading-relaxed">
                      {a.reason}
                    </div>
                  )}
                  {a.errorBody && (
                    <details className="mt-1 pl-6">
                      <summary className="text-[9px] text-workspace-text-secondary/50 cursor-pointer hover:text-workspace-text-secondary">
                        Provider error body
                      </summary>
                      <pre className="mt-1 text-[9px] font-mono text-slate-600 whitespace-pre-wrap break-words bg-slate-50 rounded px-2 py-1">
                        {a.errorBody}
                      </pre>
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <div className="text-[10px] text-workspace-text-secondary/50 italic">
          No per-attempt trace (older edge function deployment — redeploy ai-chat to capture).
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

      {/* Clear / Copy All buttons */}
      <div className="flex justify-end gap-3">
        <button
          onClick={() => {
            const text = events.map(e => {
              const time = new Date(e.timestamp).toLocaleTimeString('en-US', { hour12: false });
              const lines = [
                `[${time}] ${e.model} | ${e.provider} | ${e.authMode} | ${(e.durationMs/1000).toFixed(1)}s | in:${e.inputTokens??'?'} out:${e.outputTokens??'?'} | toolCalls:${e.toolCalls??0}`,
              ];
              if (e.fallback) {
                lines.push(`--- ROUTING ---`);
                lines.push(`Fallback: ${e.fallbackReason ?? '(no reason captured)'}`);
              }
              if (e.attempts?.length) {
                lines.push('Attempts:');
                e.attempts.forEach((a, i) => {
                  lines.push(`  ${i + 1}. [${a.status}] ${a.provider}/${a.model} via ${a.authMode}${a.httpStatus ? ` HTTP ${a.httpStatus}` : ''}${a.retry ? ` retry#${a.retry}` : ''}${a.reason ? ` — ${a.reason}` : ''}`);
                  if (a.errorBody) lines.push(`     body: ${a.errorBody}`);
                });
              }
              if (e.requestPayload) {
                lines.push('--- REQUEST ---');
                lines.push(JSON.stringify(e.requestPayload, null, 2));
              }
              return lines.join('\n');
            }).join('\n\n==========\n\n');
            navigator.clipboard.writeText(text);
          }}
          className="text-[10px] text-workspace-text-secondary/40 hover:text-workspace-text-secondary transition-colors"
        >
          Copy all logs
        </button>
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
                    <span className="text-[9px] text-workspace-accent/60 font-mono">{event.toolCalls} tool{event.toolCalls !== 1 ? 's' : ''}</span>
                  )}
                  {event.toolCalls === 0 && (
                    <span className="text-[9px] text-emerald-600/60">response</span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        const time = new Date(event.timestamp).toLocaleTimeString('en-US', { hour12: false });
                        const lines = [
                          `[${time}] ${event.model} | ${event.provider} | ${event.authMode} | ${(event.durationMs/1000).toFixed(1)}s | in:${event.inputTokens??'?'} out:${event.outputTokens??'?'} | toolCalls:${event.toolCalls??0}`,
                        ];
                        if (event.requestPayload) {
                          lines.push('--- REQUEST ---');
                          lines.push(JSON.stringify(event.requestPayload, null, 2));
                        }
                        navigator.clipboard.writeText(lines.join('\n'));
                      }}
                      className="text-[9px] text-workspace-text-secondary/30 hover:text-workspace-text-secondary transition-colors"
                    >
                      copy
                    </button>
                    {event.requestPayload && (
                      <span className="text-[9px] text-workspace-text-secondary/30">
                        {isExpanded ? 'collapse' : 'expand'}
                      </span>
                    )}
                  </span>
                </div>
                {/* Inline fallback reason — visible without expanding */}
                {event.fallback && event.fallbackReason && !isExpanded && (
                  <div className="mt-1.5 rounded-md border border-amber-200/50 bg-amber-50/70 px-2 py-1 text-[10px] leading-snug text-amber-800">
                    <span className="font-semibold">Fallback: </span>{event.fallbackReason}
                  </div>
                )}
              </div>

              {/* Expanded view: routing trace + payload */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-2">
                  <RoutingTrace event={event} />
                  {event.requestPayload ? (
                    <PayloadViewer payload={event.requestPayload} />
                  ) : (
                    <div className="rounded-lg bg-slate-900/80 px-3 py-2 text-[10px] text-slate-400 font-mono">
                      No payload captured for this call
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
