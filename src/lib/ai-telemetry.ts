/**
 * AI Telemetry — tracks model calls, billing type, and response metadata.
 * Emits custom events so UI components can subscribe to real-time updates.
 */

export interface AICallEvent {
  id: string;
  timestamp: number;
  model: string;
  provider: string;
  billing: 'subscription' | 'api-key' | 'gateway' | 'unknown';
  fallback: boolean;
  durationMs: number;
  mode: string;
  toolCalls?: number;
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
 * Extract routing metadata from response headers.
 * The edge function injects x-ai-model, x-ai-provider, x-ai-billing headers.
 */
export function extractRouteMeta(resp: Response): {
  model: string;
  provider: string;
  billing: AICallEvent['billing'];
  fallback: boolean;
} {
  return {
    model: resp.headers.get('x-ai-model') || 'unknown',
    provider: resp.headers.get('x-ai-provider') || 'unknown',
    billing: (resp.headers.get('x-ai-billing') as AICallEvent['billing']) || 'unknown',
    fallback: resp.headers.get('x-ai-fallback') === 'true',
  };
}
