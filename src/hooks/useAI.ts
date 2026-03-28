import { useState, useCallback, useRef } from 'react';

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`;

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
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

  const streamChat = useCallback(
    async (messages: Message[], options: UseAIOptions = {}) => {
      const { mode = 'intent', onDelta, onComplete, onError } = options;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsStreaming(true);
      let fullText = '';

      try {
        const body: Record<string, unknown> = { messages, mode };
        if ((options as any).documentIds) {
          body.documentIds = (options as any).documentIds;
        }

        const resp = await fetch(CHAT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

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
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullText += content;
                onDelta?.(content);
              }
            } catch {
              buffer = line + '\n' + buffer;
              break;
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
                onDelta?.(content);
              }
            } catch { /* ignore */ }
          }
        }

        onComplete?.(fullText);
        setIsStreaming(false);
        return fullText;
      } catch (e: any) {
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
  documentIds?: string[]
): Promise<string | null> {
  try {
    const body: Record<string, unknown> = { messages, mode };
    if (documentIds && documentIds.length > 0) {
      body.documentIds = documentIds;
    }

    const resp = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify(body),
    });

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
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) result += content;
        } catch { /* skip */ }
      }
    }

    return result;
  } catch {
    return null;
  }
}
