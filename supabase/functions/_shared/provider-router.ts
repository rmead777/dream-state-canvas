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
 *   - LOVABLE_API_KEY      (google — always required as fallback)
 *   - ANTHROPIC_API_KEY    (anthropic models)
 *   - OPENAI_API_KEY       (openai models)
 *   - XAI_API_KEY          (xai/grok models)
 */

type Provider = 'google' | 'anthropic' | 'openai' | 'xai';

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
    envKey: 'ANTHROPIC_API_KEY',
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

interface Message {
  role: string;
  content: string;
}

interface RouteResult {
  response: Response;
}

/**
 * Parse a model ID into provider + model name.
 * "anthropic/claude-sonnet-4-6" → { provider: "anthropic", model: "claude-sonnet-4-6" }
 */
function parseModelId(modelId: string): { provider: Provider; model: string } {
  const slash = modelId.indexOf('/');
  if (slash === -1) {
    // No provider prefix — assume Google/Lovable gateway
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
): Promise<Response> {
  const cfg = PROVIDERS['google'];
  const key = Deno.env.get(cfg.envKey);
  if (!key) {
    throw new Error(`No API keys configured — need at least ${cfg.envKey}`);
  }
  // Lovable gateway requires full "provider/model" ID
  return makeOpenAIRequest(cfg.endpoint, key, DEFAULT_MODEL, systemPrompt, messages, maxTokens, stream);
}

/**
 * Route an AI request to the correct provider.
 * Returns a streaming Response that can be piped directly to the client.
 * If the selected provider returns an auth error, automatically falls back to the default.
 */
export async function routeToProvider(
  modelId: string,
  systemPrompt: string,
  messages: Message[],
  maxTokens: number,
  stream: boolean = true,
): Promise<Response> {
  const { provider, model } = parseModelId(modelId);
  const config = PROVIDERS[provider];
  const apiKey = Deno.env.get(config.envKey);

  if (!apiKey) {
    console.warn(`[provider-router] ${config.envKey} not set, falling back to default model`);
    return fallbackToDefault(systemPrompt, messages, maxTokens, stream);
  }

  // Lovable gateway requires full "provider/model" format; others use bare model name
  const modelForRequest = provider === 'google' ? modelId : model;

  let response: Response;
  if (config.format === 'anthropic') {
    response = await makeAnthropicRequest(config.endpoint, apiKey, modelForRequest, systemPrompt, messages, maxTokens, stream);
  } else {
    response = await makeOpenAIRequest(config.endpoint, apiKey, modelForRequest, systemPrompt, messages, maxTokens, stream);
  }

  // If the provider returned an auth/client error, fall back to default gateway
  if (!response.ok && [400, 401, 403].includes(response.status) && provider !== 'google') {
    const errBody = await response.text();
    console.warn(`[provider-router] ${provider} returned ${response.status}: ${errBody}. Falling back to default.`);
    return fallbackToDefault(systemPrompt, messages, maxTokens, stream);
  }

  return response;
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
): Promise<Response> {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream,
      max_tokens: maxTokens,
    }),
  });
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
): Promise<Response> {
  // Anthropic expects system prompt as a top-level field, not in messages
  const anthropicMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      messages: anthropicMessages,
      max_tokens: maxTokens,
      stream,
    }),
  });

  if (!stream || !response.ok) return response;

  // Transform Anthropic SSE → OpenAI-compatible SSE so the client parser works unchanged
  const reader = response.body!.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

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

            // Anthropic content_block_delta → OpenAI delta format
            if (event.type === 'content_block_delta' && event.delta?.text) {
              const openaiChunk = {
                choices: [{ delta: { content: event.delta.text }, index: 0 }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
            }
            // Anthropic message_stop → OpenAI [DONE]
            if (event.type === 'message_stop') {
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
export type { Provider, ProviderConfig };
