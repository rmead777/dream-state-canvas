/**
 * AI Telemetry — tracks model calls, auth mode, and response metadata.
 * Emits custom events so UI components can subscribe to real-time updates.
 */

export type AuthMode = 'oauth' | 'api_key' | 'api_key_fallback' | 'oauth_failed' | 'gateway' | 'unknown';

export interface RouteAttempt {
  provider: string;
  model: string;
  authMode: AuthMode;
  status: 'ok' | 'error' | 'skipped';
  httpStatus?: number;
  retry?: number;
  reason?: string;
  errorBody?: string;
  durationMs?: number;
}

export interface AICallEvent {
  id: string;
  timestamp: number;
  model: string;
  provider: string;
  authMode: AuthMode;
  fallback: boolean;
  fallbackReason?: string;
  attempts?: RouteAttempt[];
  durationMs: number;
  mode: string;
  toolCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
  requestPayload?: Record<string, unknown>;
}

const MAX_EVENTS = 100;
let _events: AICallEvent[] = [];
let _nextId = 1;

export function getAITelemetryEvents(): AICallEvent[] {
  return _events;
}

export function recordAICall(event: Omit<AICallEvent, 'id'>): AICallEvent {
  const entry: AICallEvent = { ...event, id: `ai-${_nextId++}` };
  _events = [entry, ..._events].slice(0, MAX_EVENTS);
  window.dispatchEvent(new CustomEvent('ai-telemetry', { detail: entry }));
  return entry;
}

export function clearAITelemetry() {
  _events = [];
  window.dispatchEvent(new CustomEvent('ai-telemetry-clear'));
}

/**
 * Default route metadata — populated from response headers (usually blank
 * since Supabase strips them) and then overridden by __telemetry in the body.
 */
export function defaultRouteMeta(): {
  model: string;
  provider: string;
  authMode: AuthMode;
  fallback: boolean;
  fallbackReason?: string;
  attempts?: RouteAttempt[];
} {
  return {
    model: 'unknown',
    provider: 'unknown',
    authMode: 'unknown',
    fallback: false,
  };
}

export function parseRouteMeta(telemetry: any): {
  model: string;
  provider: string;
  authMode: AuthMode;
  fallback: boolean;
  fallbackReason?: string;
  attempts?: RouteAttempt[];
} {
  return {
    model: telemetry?.model || 'unknown',
    provider: telemetry?.provider || 'unknown',
    authMode: telemetry?.authMode || 'unknown',
    fallback: telemetry?.fallback ?? false,
    fallbackReason: telemetry?.fallbackReason,
    attempts: Array.isArray(telemetry?.attempts) ? telemetry.attempts : undefined,
  };
}
