/**
 * Provider Router — maps model IDs to API endpoints and auth.
 *
 * Model IDs use the format "provider/model-name" (e.g., "anthropic/claude-sonnet-4-6").
 * The router extracts the provider prefix, looks up the endpoint config,
 * and returns a fetch-ready request configuration.
 *
 * Supported providers:
 *   - google:    Lovable AI Gateway (OpenAI-compatible, default)
 *   - anthropic: Anthropic Messages API (native format)
 *   - openai:    OpenAI Chat Completions API
 *   - xai:       xAI/Grok API (OpenAI-compatible)
 *
 * Required env vars per provider:
 *   - LOVABLE_API_KEY          (google — always required as fallback)
 *   - CLAUDE_CODE_OAUTH_TOKEN  (anthropic — subscription, zero per-token cost)
 *   - ANTHROPIC_API_KEY        (anthropic — paid API key fallback)
 *   - OPENAI_API_KEY           (openai models)
 *   - XAI_API_KEY              (xai/grok models)
 *
 * Anthropic auth chain: OAuth → API key → Google gateway
 */

type Provider = 'google' | 'anthropic' | 'openai' | 'xai';
type AuthMode = 'oauth' | 'api_key' | 'api_key_fallback' | 'oauth_failed' | 'gateway';

interface ProviderConfig {
  endpoint: string;
  envKey: string;
  format: 'openai' | 'anthropic';
}

const PROVIDERS: Record<Provider, ProviderConfig> = {
  google: {
    endpoint: 'https://ai.gateway.lovable.dev/v1/chat/completions',
    envKey: 'LOVABLE_API_KEY',
    format: 'openai',
  },
  anthropic: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    envKey: 'CLAUDE_CODE_OAUTH_TOKEN',
    format: 'anthropic',
  },
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    envKey: 'OPENAI_API_KEY',
    format: 'openai',
  },
  xai: {
    endpoint: 'https://api.x.ai/v1/chat/completions',
    envKey: 'XAI_API_KEY',
    format: 'openai',
  },
};

const DEFAULT_MODEL = 'google/gemini-3-flash-preview';

interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

interface Message {
  role: string;
  content: string | null | ContentPart[];
}

interface RouteResult {
  response: Response;
  meta: RouteMeta;
}

export interface RouteMeta {
  model: string;
  provider: Provider;
  authMode: AuthMode;
  fallback: boolean;
}

/**
 * Parse a model ID into provider + model name.
 * "anthropic/claude-sonnet-4-6" → { provider: "anthropic", model: "claude-sonnet-4-6" }
 */
function parseModelId(modelId: string): { provider: Provider; model: string } {
  const slash = modelId.indexOf('/');
  if (slash === -1) {
    return { provider: 'google', model: modelId };
  }
  const prefix = modelId.slice(0, slash) as Provider;
  const model = modelId.slice(slash + 1);
  if (!PROVIDERS[prefix]) {
    console.warn(`[provider-router] Unknown provider "${prefix}", falling back to google`);
    return { provider: 'google', model: modelId };
  }
  return { provider: prefix, model };
}

/**
 * Fallback to the default Google/Lovable gateway model.
 */
async function fallbackToDefault(
  systemPrompt: string,
  messages: Message[],
  maxTokens: number,
  stream: boolean,
  tools?: any[],
): Promise<Response> {
  const cfg = PROVIDERS['google'];
  const key = Deno.env.get(cfg.envKey);
  if (!key) {
    throw new Error(`No API keys configured — need at least ${cfg.envKey}`);
  }
  return makeOpenAIRequest(cfg.endpoint, key, DEFAULT_MODEL, systemPrompt, messages, maxTokens, stream, tools);
}

/**
 * Route an AI request to the correct provider.
 * Returns a Response + routing metadata.
 *
 * For Anthropic: tries OAuth subscription first, then API key, then Google gateway.
 * For other providers: tries the provider's key, then Google gateway.
 */
export async function routeToProvider(
  modelId: string,
  systemPrompt: string,
  messages: Message[],
  maxTokens: number,
  stream: boolean = true,
  tools?: any[],
): Promise<RouteResult> {
  const { provider, model } = parseModelId(modelId);
  const config = PROVIDERS[provider];

  // ─── Anthropic: OAuth → API key, with retry. NEVER falls back to Google. ───
  if (provider === 'anthropic') {
    const oauthToken = Deno.env.get('CLAUDE_CODE_OAUTH_TOKEN');
    const legacyKey = Deno.env.get('ANTHROPIC_API_KEY');

    if (!oauthToken && !legacyKey) {
      // No Anthropic auth at all — return a clear error, don't silently switch models
      return {
        response: new Response(JSON.stringify({ error: 'No Anthropic API credentials configured. Set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY.' }), { status: 500 }),
        meta: { model: modelId, provider, authMode: 'oauth_failed', fallback: false },
      };
    }

    // Try OAuth first, then API key. Retry up to 3 times with backoff on 429/5xx.
    const attempts: { key: string; useOAuth: boolean; authMode: AuthMode }[] = [];
    if (oauthToken) attempts.push({ key: oauthToken, useOAuth: true, authMode: 'oauth' });
    if (legacyKey) attempts.push({ key: legacyKey, useOAuth: false, authMode: 'api_key' });

    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [2000, 4000, 8000]; // exponential backoff

    for (const attempt of attempts) {
      for (let retry = 0; retry <= MAX_RETRIES; retry++) {
        if (retry > 0) {
          const delay = RETRY_DELAYS[retry - 1] || 8000;
          console.log(`[anthropic] Retry ${retry}/${MAX_RETRIES} for ${model} (${attempt.authMode}) in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }

        const response = await makeAnthropicRequest(
          config.endpoint, attempt.key, model, systemPrompt, messages, maxTokens, stream, tools, attempt.useOAuth,
        );

        if (response.ok) {
          console.log(`[anthropic] model=${model} auth=${attempt.authMode}${retry > 0 ? ` (retry ${retry})` : ''}`);
          return { response, meta: { model: modelId, provider, authMode: attempt.authMode, fallback: false } };
        }

        // Only retry on rate limits (429) and server errors (5xx)
        if (response.status === 429 || response.status >= 500) {
          const errBody = await response.text();
          console.warn(`[anthropic] ${attempt.authMode} ${response.status} for ${model}: ${errBody.slice(0, 150)}`);
          continue; // retry
        }

        // Non-retryable error (400, 401, 403) — try next auth method
        const errBody = await response.text();
        console.warn(`[anthropic] ${attempt.authMode} failed (${response.status}) for ${model}: ${errBody.slice(0, 150)}`);
        break; // don't retry, try next auth method
      }
    }

    // All attempts exhausted — return error, NEVER fall back to a different model
    console.error(`[anthropic] All auth attempts exhausted for ${model}`);
    return {
      response: new Response(JSON.stringify({ error: `Anthropic API unavailable after retries. Please try again shortly.` }), { status: 503 }),
      meta: { model: modelId, provider, authMode: 'oauth_failed', fallback: false },
    };
  }

  // ─── Non-Anthropic providers ───────────────────────────────────────
  const apiKey = Deno.env.get(config.envKey);

  if (!apiKey) {
    console.warn(`[provider-router] No API key for ${provider}, falling back to default model`);
    const response = await fallbackToDefault(systemPrompt, messages, maxTokens, stream, tools);
    return { response, meta: { model: DEFAULT_MODEL, provider: 'google', authMode: 'gateway', fallback: true } };
  }

  const modelForRequest = provider === 'google' ? modelId : model;
  const response = await makeOpenAIRequest(config.endpoint, apiKey, modelForRequest, systemPrompt, messages, maxTokens, stream, tools);

  if (!response.ok && [400, 401, 403, 429].includes(response.status) && provider !== 'google') {
    const errBody = await response.text();
    console.warn(`[provider-router] ${provider} returned ${response.status}: ${errBody}. Falling back to default.`);
    const fallbackResp = await fallbackToDefault(systemPrompt, messages, maxTokens, stream, tools);
    return { response: fallbackResp, meta: { model: DEFAULT_MODEL, provider: 'google', authMode: 'gateway', fallback: true } };
  }

  const authMode: AuthMode = provider === 'google' ? 'gateway' : 'api_key';
  return { response, meta: { model: modelId, provider, authMode, fallback: false } };
}

/**
 * OpenAI-compatible request (works for Google/Lovable, OpenAI, xAI).
 */
async function makeOpenAIRequest(
  endpoint: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: Message[],
  maxTokens: number,
  stream: boolean,
  tools?: any[],
): Promise<Response> {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    stream,
    max_tokens: maxTokens,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Convert OpenAI-style content (string or ContentPart[]) to Anthropic's native format.
 * - text parts → { type: 'text', text }
 * - image_url parts with PDF data URI → { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
 * - image_url parts with image data URI → { type: 'image', source: { type: 'base64', media_type, data } }
 * - image_url parts with https URL → { type: 'image', source: { type: 'url', url } }
 *
 * PDFs are routed to Anthropic's native document type, which preserves layout and
 * extracts text, tables, and figures with higher fidelity than vision-based image reading.
 */
function toAnthropicContent(content: string | null | ContentPart[]): string | any[] {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  return content.map(part => {
    if (part.type === 'text') return { type: 'text', text: part.text ?? '' };
    if (part.type === 'image_url' && part.image_url?.url) {
      const url = part.image_url.url;
      if (url.startsWith('data:')) {
        const commaIdx = url.indexOf(',');
        const header = url.slice(5, commaIdx).replace(';base64', '');
        const data = url.slice(commaIdx + 1);
        const mediaType = header || 'image/jpeg';
        // PDFs use Anthropic's native document type for layout-aware extraction
        if (mediaType === 'application/pdf') {
          return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
        }
        return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
      }
      return { type: 'image', source: { type: 'url', url } };
    }
    return { type: 'text', text: '' };
  });
}

/**
 * Detect whether a messages array contains any PDF documents.
 * Used to attach the PDF beta header for the Messages API.
 */
function containsPdfContent(messages: Message[]): boolean {
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content) {
      if (part.type === 'image_url' && part.image_url?.url?.startsWith('data:application/pdf')) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Anthropic Messages API request.
 * Converts OpenAI-style messages to Anthropic format and streams via SSE.
 * Re-wraps Anthropic's SSE events into OpenAI-compatible format so the
 * client's SSE parser doesn't need to change.
 */
async function makeAnthropicRequest(
  endpoint: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: Message[],
  maxTokens: number,
  stream: boolean,
  tools?: any[],
  useOAuth: boolean = false,
): Promise<Response> {
  // Anthropic expects system prompt as a top-level field, not in messages
  const anthropicMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => {
      // Tool result → Anthropic user message with tool_result content block
      if ((m as any).role === 'tool') {
        return {
          role: 'user' as const,
          content: [{ type: 'tool_result', tool_use_id: (m as any).tool_call_id, content: typeof m.content === 'string' ? m.content : '' }],
        };
      }
      // Assistant message with tool_calls → Anthropic content block array
      if (m.role === 'assistant' && (m as any).tool_calls?.length > 0) {
        const blocks: any[] = [];
        if (m.content && typeof m.content === 'string') blocks.push({ type: 'text', text: m.content });
        for (const tc of (m as any).tool_calls) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(tc.function.arguments); } catch {}
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
        }
        return { role: 'assistant' as const, content: blocks };
      }
      return { role: m.role as 'user' | 'assistant', content: toAnthropicContent(m.content) };
    });

  // OAuth requires system as array with Claude Code identity as first block
  const systemField = useOAuth
    ? [
        { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
        { type: 'text', text: systemPrompt },
      ]
    : systemPrompt;

  const body: Record<string, unknown> = {
    model,
    system: systemField,
    messages: anthropicMessages,
    max_tokens: maxTokens,
    stream,
  };

  if (tools && tools.length > 0) {
    body.tools = tools.map(t => ({
      name: t.function?.name || t.name,
      description: t.function?.description || t.description,
      input_schema: t.function?.parameters || t.parameters,
    }));
  }

  // Detect PDF content — triggers the PDF beta header for native document support
  const hasPdf = containsPdfContent(messages);

  // OAuth uses Bearer auth + required headers; legacy uses x-api-key
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };

  if (useOAuth) {
    headers['Authorization'] = `Bearer ${apiKey}`;
    const betaFeatures = [
      'claude-code-20250219',
      'oauth-2025-04-20',
      'fine-grained-tool-streaming-2025-05-14',
      'interleaved-thinking-2025-05-14',
    ];
    if (hasPdf) betaFeatures.push('pdfs-2024-09-25');
    headers['anthropic-beta'] = betaFeatures.join(',');
    headers['user-agent'] = 'claude-cli/2.1.88 (external, cli)';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    headers['x-app'] = 'cli';
  } else {
    headers['x-api-key'] = apiKey;
    if (hasPdf) headers['anthropic-beta'] = 'pdfs-2024-09-25';
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!stream || !response.ok) return response;

  // Transform Anthropic SSE → OpenAI-compatible SSE so the client parser works unchanged
  const reader = response.body!.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let activeToolBlock: { id: string; name: string; inputJson: string } | null = null;
  const completedToolCalls: { id: string; type: 'function'; function: { name: string; arguments: string } }[] = [];

  const transformedStream = new ReadableStream({
    async pull(controller) {
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);

          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json || json === '[DONE]') continue;

          try {
            const event = JSON.parse(json);

            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              const openaiChunk = {
                choices: [{ delta: { content: event.delta.text }, index: 0 }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
            }

            if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
              activeToolBlock = {
                id: event.content_block.id,
                name: event.content_block.name,
                inputJson: '',
              };
            }

            if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta' && activeToolBlock) {
              activeToolBlock.inputJson += event.delta.partial_json;
            }

            if (event.type === 'content_block_stop' && activeToolBlock) {
              completedToolCalls.push({
                id: activeToolBlock.id,
                type: 'function',
                function: {
                  name: activeToolBlock.name,
                  arguments: activeToolBlock.inputJson,
                },
              });
              activeToolBlock = null;
            }

            if (event.type === 'message_stop') {
              if (completedToolCalls.length > 0) {
                const toolCallChunk = {
                  choices: [{
                    message: {
                      role: 'assistant',
                      content: null,
                      tool_calls: completedToolCalls,
                    },
                    index: 0,
                    finish_reason: 'tool_calls',
                  }],
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(toolCallChunk)}\n\n`));
              }
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
              return;
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    },
  });

  return new Response(transformedStream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

export { DEFAULT_MODEL, PROVIDERS, parseModelId };
export type { Provider, ProviderConfig, AuthMode };
