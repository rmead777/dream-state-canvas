import { useState, useCallback, useRef } from 'react';

import { getAdminSettings } from '@/lib/admin-settings';
import { getPromptOverride } from '@/lib/system-prompts';
import { supabase } from '@/integrations/supabase/client';
import { recordAICall, defaultRouteMeta, parseRouteMeta } from '@/lib/ai-telemetry';

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`;

/** Get the user's session token for authenticated edge function calls */
async function getAuthToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentPart[];
}

interface UseAIOptions {
  mode?: string;
  onDelta?: (text: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: string) => void;
}

export function useAI() {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const deltaBufferRef = useRef('');
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const streamChat = useCallback(
    async (messages: Message[], options: UseAIOptions = {}) => {
      const { mode = 'intent', onDelta, onComplete, onError } = options;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsStreaming(true);
      let fullText = '';
      deltaBufferRef.current = '';
      const callStartTime = Date.now();

      // Batched flush: accumulate tokens, flush every 80ms to avoid per-token re-renders
      const flushDelta = () => {
        if (deltaBufferRef.current && onDelta) {
          onDelta(deltaBufferRef.current);
          deltaBufferRef.current = '';
        }
      };
      const scheduleDeltaFlush = () => {
        if (!flushTimerRef.current) {
          flushTimerRef.current = setTimeout(() => {
            flushDelta();
            flushTimerRef.current = null;
          }, 80);
        }
      };

      try {
        const admin = getAdminSettings();
        const body: Record<string, unknown> = { messages, mode };
        if ((options as any).documentIds) {
          body.documentIds = (options as any).documentIds;
        }
        if (admin.isUnlocked) {
          body.adminModel = admin.model;
          body.adminMaxTokens = admin.maxTokens;
        }
        // Send prompt override if admin has customized this mode
        const promptOverride = getPromptOverride(mode);
        if (promptOverride) body.promptOverride = promptOverride;

        const token = await getAuthToken();
        const resp = await fetch(CHAT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        // routeMeta will be populated from SSE __telemetry event injected by edge function
        let routeMeta = defaultRouteMeta();

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: 'Request failed' }));
          onError?.(err.error || `Error ${resp.status}`);
          setIsStreaming(false);
          return null;
        }

        if (!resp.body) {
          onError?.('No response body');
          setIsStreaming(false);
          return null;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let parseRetries = 0;
        const MAX_PARSE_RETRIES = 3; // Prevent infinite retry on genuinely malformed JSON

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
            let line = buffer.slice(0, newlineIdx);
            buffer = buffer.slice(newlineIdx + 1);

            if (line.endsWith('\r')) line = line.slice(0, -1);
            if (line.startsWith(':') || line.trim() === '') continue;
            if (!line.startsWith('data: ')) continue;

            const jsonStr = line.slice(6).trim();
            if (jsonStr === '[DONE]') break;

            try {
              const parsed = JSON.parse(jsonStr);

              // Intercept telemetry event from edge function
              if (parsed.__telemetry) {
                routeMeta = parseRouteMeta(parsed.__telemetry);
                parseRetries = 0;
                continue;
              }

              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullText += content;
                deltaBufferRef.current += content;
                scheduleDeltaFlush();
              }
              parseRetries = 0; // Reset on successful parse
            } catch {
              parseRetries++;
              if (parseRetries < MAX_PARSE_RETRIES) {
                // Might be an incomplete JSON chunk split across reads — push back and wait for more data
                buffer = line + '\n' + buffer;
                break;
              }
              // Genuinely malformed — skip it and reset counter
              console.warn('[useAI] Skipping malformed SSE line after retries:', jsonStr.slice(0, 80));
              parseRetries = 0;
            }
          }
        }

        // Flush remaining
        if (buffer.trim()) {
          for (let raw of buffer.split('\n')) {
            if (!raw) continue;
            if (raw.endsWith('\r')) raw = raw.slice(0, -1);
            if (!raw.startsWith('data: ')) continue;
            const jsonStr = raw.slice(6).trim();
            if (jsonStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullText += content;
                deltaBufferRef.current += content;
              }
            } catch (e) { console.warn('[useAI] Failed to parse SSE flush line:', e); }
          }
        }

        // Final flush — ensure last buffered tokens arrive
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        flushDelta();

        // Record telemetry
        recordAICall({
          timestamp: Date.now(),
          model: routeMeta.model,
          provider: routeMeta.provider,
          authMode: routeMeta.authMode,
          fallback: routeMeta.fallback,
          durationMs: Date.now() - callStartTime,
          mode,
        });

        onComplete?.(fullText);
        setIsStreaming(false);
        return fullText;
      } catch (e: any) {
        // Clean up flush timer on error
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        flushDelta();

        if (e.name === 'AbortError') {
          setIsStreaming(false);
          return null;
        }
        onError?.(e.message || 'Unknown error');
        setIsStreaming(false);
        return null;
      }
    },
    []
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { streamChat, isStreaming, cancel };
}

/**
 * Non-streaming call — returns full text at once. Simpler for JSON parsing.
 */
export async function callAI(
  messages: Message[],
  mode: string = 'intent',
  documentIds?: string[],
  memories?: string
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const callStartTime = Date.now();

  try {
    const admin = getAdminSettings();
    const body: Record<string, unknown> = { messages, mode };
    if (documentIds && documentIds.length > 0) {
      body.documentIds = documentIds;
    }
    if (memories) {
      body.memories = memories;
    }
    if (admin.isUnlocked) {
      body.adminModel = admin.model;
      body.adminMaxTokens = admin.maxTokens;
    }
    // Send prompt override if admin has customized this mode
    const promptOverride = getPromptOverride(mode);
    if (promptOverride) body.promptOverride = promptOverride;

    const token = await getAuthToken();
    const resp = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    let routeMeta = defaultRouteMeta();

    if (!resp.ok) return null;
    if (!resp.body) return null;

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          // Intercept telemetry event
          if (parsed.__telemetry) {
            routeMeta = parseRouteMeta(parsed.__telemetry);
            continue;
          }
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) result += content;
        } catch (e) { console.warn('[callAI] Failed to parse SSE line:', e); }
      }
    }

    recordAICall({
      timestamp: Date.now(),
      model: routeMeta.model,
      provider: routeMeta.provider,
      authMode: routeMeta.authMode,
      fallback: routeMeta.fallback,
      fallbackReason: routeMeta.fallbackReason,
      attempts: routeMeta.attempts,
      durationMs: Date.now() - callStartTime,
      mode,
    });

    return result;
  } catch (e: any) {
    if (e.name === 'AbortError') {
      console.error('[callAI] Request timed out after 30 seconds');
    } else {
      console.error('[callAI] Error:', e.message || e);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
