# Knowledge Transfer — Multi-Provider AI API Architecture

> **Audience:** Another Claude Code instance about to replicate this app's API-call setup in a new project.
> **Scope:** Just the plumbing — model registry, provider router, edge-function entry point, client hooks, and the Anthropic OAuth subscription path. No business logic, no tool execution, no streaming UI.

---

## 1. The Big Picture

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (React/Vite)                                            │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ src/hooks/useAI.ts                                         │  │
│  │   • streamChat()  — SSE streaming                          │  │
│  │   • callAI()      — non-streaming                          │  │
│  │ Reads admin settings (model, maxTokens) from localStorage  │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬───────────────────────────────────┘
                               │ POST /functions/v1/ai-chat
                               │ { messages, mode, adminModel?, ... }
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  Supabase Edge Function: ai-chat                                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ supabase/functions/ai-chat/index.ts                        │  │
│  │   • Picks system prompt by `mode`                          │  │
│  │   • Picks model: adminModel || DEFAULT_MODEL               │  │
│  │   • Calls routeToProvider(...)                             │  │
│  │   • Wraps stream with __telemetry SSE event                │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ supabase/functions/_shared/provider-router.ts              │  │
│  │   parseModelId("anthropic/claude-opus-4-7")                │  │
│  │     → { provider: "anthropic", model: "claude-opus-4-7" }  │  │
│  │   Anthropic path: OAuth → API key (NO gateway fallback)    │  │
│  │   Other paths:    provider key → Google/Lovable fallback   │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬───────────────────────────────────┘
                               ▼
        ┌──────────────────────┴──────────────────────┐
        ▼              ▼              ▼               ▼
   Anthropic       OpenAI         xAI/Grok      Lovable/Google
  (Messages API) (Chat Comp)    (Chat Comp)    (OpenAI-compatible)
```

**Two unbreakable rules baked into this design:**

1. **Model IDs are namespaced strings: `provider/model-name`.** The provider prefix IS the routing decision. Strip it before sending to the provider.
2. **The provider router lives in the edge function, not the client.** The browser never holds API keys. It just says "I want `anthropic/claude-opus-4-7`" and the server decides how to authenticate.

---

## 2. Model Registry (Client-Side)

A single source of truth for which models the user can pick.

**File:** `src/lib/admin-settings.ts`

```ts
export type AIProvider = 'google' | 'anthropic' | 'openai' | 'xai';

export interface ModelDef {
  id: string;          // "anthropic/claude-opus-4-7"
  label: string;       // "Claude Opus 4.7"
  description: string;
  provider: AIProvider;
}

const AVAILABLE_MODELS: ModelDef[] = [
  // Default — routed through Lovable AI Gateway (OpenAI-compatible)
  { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash',
    description: 'Fast & balanced (default)', provider: 'google' },
  { id: 'google/gemini-3.1-pro-preview',  label: 'Gemini 3.1 Pro',
    description: 'Maximum reasoning depth', provider: 'google' },

  // Anthropic — uses CLAUDE_CODE_OAUTH_TOKEN (subscription, zero per-token cost)
  { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6',
    description: 'Balanced',           provider: 'anthropic' },
  { id: 'anthropic/claude-opus-4-7',   label: 'Claude Opus 4.7',
    description: 'Max reasoning',      provider: 'anthropic' },
  { id: 'anthropic/claude-haiku-4-5',  label: 'Claude Haiku 4.5',
    description: 'Fastest',            provider: 'anthropic' },

  // OpenAI / xAI — uses standard API keys
  { id: 'openai/gpt-5.4-2026-03-05', label: 'GPT-5.4',  provider: 'openai',
    description: 'OpenAI flagship' },
  { id: 'xai/grok-4.20-beta',        label: 'Grok 4.20', provider: 'xai',
    description: 'Latest Grok' },
];
```

The active model is stored in `localStorage` under `admin-settings`, gated behind a passphrase ("admin mode"). Default model:

```ts
const DEFAULT_SETTINGS: AdminSettings = {
  isUnlocked: false,
  model: 'google/gemini-3-flash-preview',
  maxTokens: 16192,
  contextWindow: 10,
  agentMaxIterations: 8,
};
```

`getAdminSettings()` returns a snapshot, `setAdminModel(id)` persists the choice. Both `useAI()` and `callAI()` read this on every call so the user can swap models live.

---

## 3. The Provider Router — Heart of the System

**File:** `supabase/functions/_shared/provider-router.ts`

### 3a. Provider Config Map

```ts
type Provider = 'google' | 'anthropic' | 'openai' | 'xai';

const PROVIDERS: Record<Provider, ProviderConfig> = {
  google: {
    endpoint: 'https://ai.gateway.lovable.dev/v1/chat/completions',
    envKey:   'LOVABLE_API_KEY',
    format:   'openai',
  },
  anthropic: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    envKey:   'CLAUDE_CODE_OAUTH_TOKEN',  // primary; ANTHROPIC_API_KEY is fallback
    format:   'anthropic',
  },
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    envKey:   'OPENAI_API_KEY',
    format:   'openai',
  },
  xai: {
    endpoint: 'https://api.x.ai/v1/chat/completions',
    envKey:   'XAI_API_KEY',
    format:   'openai',
  },
};

const DEFAULT_MODEL = 'google/gemini-3-flash-preview';
```

### 3b. Parsing the Model ID

```ts
function parseModelId(modelId: string): { provider: Provider; model: string } {
  const slash = modelId.indexOf('/');
  if (slash === -1) return { provider: 'google', model: modelId };
  const prefix = modelId.slice(0, slash) as Provider;
  const model  = modelId.slice(slash + 1);
  if (!PROVIDERS[prefix]) return { provider: 'google', model: modelId };
  return { provider: prefix, model };
}
```

### 3c. The Router Itself — Two Branches

The router has **two completely different fallback strategies**, and the difference is intentional:

```ts
export async function routeToProvider(
  modelId: string,
  systemPrompt: string,
  messages: Message[],
  maxTokens: number,
  stream: boolean = true,
  tools?: any[],
): Promise<{ response: Response; meta: RouteMeta }> {
  const { provider, model } = parseModelId(modelId);

  // ──────────── ANTHROPIC: OAuth → API key. NEVER gateway fallback. ────────────
  if (provider === 'anthropic') {
    const oauthToken = Deno.env.get('CLAUDE_CODE_OAUTH_TOKEN');
    const legacyKey  = Deno.env.get('ANTHROPIC_API_KEY');

    if (!oauthToken && !legacyKey) {
      return {
        response: new Response(JSON.stringify({
          error: 'No Anthropic credentials. Set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY.'
        }), { status: 500 }),
        meta: { model: modelId, provider, authMode: 'oauth_failed', fallback: false },
      };
    }

    const attempts = [];
    if (oauthToken) attempts.push({ key: oauthToken, useOAuth: true,  authMode: 'oauth' });
    if (legacyKey)  attempts.push({ key: legacyKey,  useOAuth: false, authMode: 'api_key' });

    const RETRY_DELAYS = [2000, 4000, 8000];
    for (const attempt of attempts) {
      for (let retry = 0; retry <= 3; retry++) {
        if (retry > 0) await new Promise(r => setTimeout(r, RETRY_DELAYS[retry - 1] ?? 8000));
        const response = await makeAnthropicRequest(/* … */);
        if (response.ok) return { response, meta: { /* … */ authMode: attempt.authMode, fallback: false } };
        if (response.status === 429 || response.status >= 500) continue;  // retry
        break;  // 4xx → try next auth method
      }
    }
    // Both OAuth and API key exhausted — return 503, do NOT swap models.
    return { response: new Response(JSON.stringify({
      error: 'Anthropic API unavailable after retries.'
    }), { status: 503 }), meta: { /* oauth_failed */ } };
  }

  // ──────────── OTHER PROVIDERS: try key, fall back to Lovable gateway ────────────
  const apiKey = Deno.env.get(PROVIDERS[provider].envKey);
  if (!apiKey) {
    const response = await fallbackToDefault(/* uses LOVABLE_API_KEY */);
    return { response, meta: { model: DEFAULT_MODEL, provider: 'google',
                               authMode: 'gateway', fallback: true } };
  }

  const response = await makeOpenAIRequest(/* … */);
  if (!response.ok && [400, 401, 403, 429].includes(response.status) && provider !== 'google') {
    const fallbackResp = await fallbackToDefault(/* … */);
    return { response: fallbackResp, meta: { /* gateway fallback */ } };
  }
  return { response, meta: { model: modelId, provider,
                             authMode: provider === 'google' ? 'gateway' : 'api_key',
                             fallback: false } };
}
```

**Why the asymmetry?** If the user explicitly picks Claude Opus, silently falling back to Gemini would be a lie about which model produced the answer — and answer quality varies enough that the user needs to know. For OpenAI/xAI we treat the Lovable gateway as a "lights stay on" safety net, but for Anthropic we surface the failure.

---

## 4. Anthropic OAuth Subscription — The Tricky Part

This is the only piece that's not just "set an API key." It lets the app call Claude through a Claude Code subscription token instead of paying per-token via `ANTHROPIC_API_KEY`. Every detail below is load-bearing — Anthropic returns 401 if any one is missing.

### 4a. Required headers (OAuth path only)

```ts
headers['Authorization']  = `Bearer ${oauthToken}`;
headers['anthropic-version'] = '2023-06-01';
headers['anthropic-beta'] = [
  'claude-code-20250219',
  'oauth-2025-04-20',
  'fine-grained-tool-streaming-2025-05-14',
  'interleaved-thinking-2025-05-14',
  // 'pdfs-2024-09-25'  ← add if any message contains a PDF data URI
].join(',');
headers['user-agent'] = 'claude-cli/2.1.88 (external, cli)';
headers['anthropic-dangerous-direct-browser-access'] = 'true';
headers['x-app'] = 'cli';
```

### 4b. The `system` field MUST be an array, with the Claude Code identity FIRST

```ts
const systemField = useOAuth
  ? [
      { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
      { type: 'text', text: yourActualSystemPrompt },
    ]
  : yourActualSystemPrompt;  // legacy x-api-key path takes a plain string
```

Without that first identity block, Anthropic rejects the request as "OAuth tokens are only valid for Claude Code."

### 4c. API-key fallback uses different headers

```ts
headers['x-api-key']      = apiKey;
headers['anthropic-version'] = '2023-06-01';
// NO Bearer auth, NO user-agent override, NO claude-code-20250219 beta.
// PDF beta still allowed: headers['anthropic-beta'] = 'pdfs-2024-09-25';
```

### 4d. Extended thinking — gen-dependent API

OAuth requests turn on extended thinking, but the API differs by model generation:

```ts
const useThinking = useOAuth;
const isAdaptive = /claude-(opus|sonnet|haiku)-4-7/i.test(model);

if (useThinking) {
  if (isAdaptive) {
    body.thinking = { type: 'adaptive' };
    body.output_config = { effort: 'medium' };  // low|medium|high|max|xhigh
  } else {
    body.thinking = { type: 'enabled', budget_tokens: 5000 };
    // Legacy thinking requires max_tokens > budget_tokens + 4096
    body.max_tokens = Math.max(maxTokens, 5000 + 4096);
  }
}
```

**Sampling caveat (Claude 4.7+):** Setting any non-default `temperature`, `top_p`, or `top_k` returns 400. Just don't pass them.

### 4e. Translating OpenAI-style messages → Anthropic native format

Two non-obvious transforms:

1. **Tool results: role `tool` → `user` with a `tool_result` content block.**

   ```ts
   if (m.role === 'tool') {
     return {
       role: 'user',
       content: [{ type: 'tool_result', tool_use_id: m.tool_call_id,
                   content: typeof m.content === 'string' ? m.content : '' }],
     };
   }
   ```

2. **Assistant tool calls: flatten `tool_calls[]` into `tool_use` content blocks.**

   ```ts
   if (m.role === 'assistant' && m.tool_calls?.length > 0) {
     const blocks = [];
     if (m.content) blocks.push({ type: 'text', text: m.content });
     for (const tc of m.tool_calls) {
       blocks.push({
         type: 'tool_use',
         id: tc.id,
         name: tc.function.name,
         input: JSON.parse(tc.function.arguments),  // wrap in try/catch
       });
     }
     return { role: 'assistant', content: blocks };
   }
   ```

3. **PDFs ride on Anthropic's native `document` type, not as images.** Detect any `data:application/pdf;base64,…` in `image_url` parts and emit:

   ```ts
   { type: 'document',
     source: { type: 'base64', media_type: 'application/pdf', data } }
   ```

### 4f. Re-wrap Anthropic SSE → OpenAI-compatible SSE

So the **client SSE parser stays unchanged across all providers**, the edge function transforms Anthropic events on the way out:

| Anthropic event                                         | Emit                                                                    |
|---------------------------------------------------------|-------------------------------------------------------------------------|
| `content_block_delta` with `delta.type: 'text_delta'`   | `data: {"choices":[{"delta":{"content":"..."},"index":0}]}`             |
| `content_block_start` with `content_block.type: 'tool_use'` | start buffering tool block                                          |
| `content_block_delta` with `delta.type: 'input_json_delta'` | append `delta.partial_json` to buffer                              |
| `content_block_stop`                                    | push `{ id, type: 'function', function: { name, arguments } }`          |
| `message_stop`                                          | emit `tool_calls` chunk if any, then `data: [DONE]`                     |

See `makeAnthropicRequest` in [provider-router.ts](supabase/functions/_shared/provider-router.ts) for the full transform.

---

## 5. Edge Function Entry Point

**File:** `supabase/functions/ai-chat/index.ts`

The whole edge function is ~1000 lines, but 95% of it is **system prompts**. The actual API plumbing is small:

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { routeToProvider, DEFAULT_MODEL } from "../_shared/provider-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, " +
    "x-supabase-client-platform, x-supabase-client-platform-version, " +
    "x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const {
    messages, mode,
    adminModel, adminMaxTokens,    // user's overrides from localStorage
    promptOverride,                // optional system-prompt override
    tools,                         // OpenAI function-calling format
    stream: streamRequested,
  } = await req.json();

  const shouldStream = streamRequested !== false;

  const systemPrompts: Record<string, string> = {
    agent: `You are …`,            // your big system prompts live here
    intent: `You are …`,
    // …
  };

  const systemPrompt = promptOverride
    || systemPrompts[mode]
    || systemPrompts.intent;

  const modelId  = adminModel || DEFAULT_MODEL;
  const maxTokens = adminMaxTokens ?? 16192;

  const { response, meta } = await routeToProvider(
    modelId, systemPrompt, messages, maxTokens, shouldStream, tools,
  );

  if (!response.ok) {
    if (response.status === 429) return errResp(429, "Rate limited.");
    if (response.status === 402) return errResp(402, "Credits exhausted.");
    return errResp(500, "AI gateway error");
  }

  // Streaming: prepend a __telemetry SSE event so the client knows what model answered.
  const telemetryLine = `data: ${JSON.stringify({ __telemetry: meta })}\n\n`;
  const encoder = new TextEncoder();

  const wrappedStream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(telemetryLine));
      const reader = response.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } finally { controller.close(); }
    },
  });

  return new Response(wrappedStream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "X-Accel-Buffering": "no",
    },
  });
});
```

**Why telemetry-via-SSE-event instead of headers?** Supabase's edge runtime strips most custom response headers from streamed responses. Embedding `__telemetry` as the first SSE event sidesteps the issue and still arrives before the first content token.

---

## 6. Client Hook

**File:** `src/hooks/useAI.ts`

```ts
const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`;

async function getAuthToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
}

// Build request body — admin overrides are conditional, never always-sent
const body: Record<string, unknown> = { messages, mode };
if (admin.isUnlocked) {
  body.adminModel = admin.model;
  body.adminMaxTokens = admin.maxTokens;
}
const promptOverride = getPromptOverride(mode);
if (promptOverride) body.promptOverride = promptOverride;

const resp = await fetch(CHAT_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${await getAuthToken()}`,
  },
  body: JSON.stringify(body),
  signal: controller.signal,   // AbortController for cancel()
});
```

### SSE parsing — three things to get right

1. **Buffered delta flush, not per-token re-renders.** Per-token `setState` melts React. Accumulate in a ref, flush every 80ms with `setTimeout`.

   ```ts
   const scheduleDeltaFlush = () => {
     if (!flushTimerRef.current) {
       flushTimerRef.current = setTimeout(() => {
         if (deltaBufferRef.current && onDelta) {
           onDelta(deltaBufferRef.current);
           deltaBufferRef.current = '';
         }
         flushTimerRef.current = null;
       }, 80);
     }
   };
   ```

2. **Handle JSON split across reads.** If `JSON.parse` throws, it's usually because a chunk landed mid-object. Push the line back into the buffer and wait for more data — but cap retries (3) so a genuinely malformed line can't loop forever.

3. **Intercept the `__telemetry` event.** Don't surface it as content; route it to `recordAICall()` for observability.

   ```ts
   const parsed = JSON.parse(jsonStr);
   if (parsed.__telemetry) {
     routeMeta = parseRouteMeta(parsed.__telemetry);
     continue;
   }
   const content = parsed.choices?.[0]?.delta?.content;
   if (content) { /* … buffer + flush … */ }
   ```

4. **Always final-flush on completion AND on error.** Otherwise the last 80ms of tokens vanish silently when the stream ends fast or aborts.

---

## 7. Telemetry (Observability)

**File:** `src/lib/ai-telemetry.ts`

Lightweight, in-memory ring buffer (last 100 events) with a custom event so any UI panel can subscribe:

```ts
export interface AICallEvent {
  id: string;
  timestamp: number;
  model: string;
  provider: string;
  authMode: 'oauth' | 'api_key' | 'gateway' | 'oauth_failed' | 'unknown';
  fallback: boolean;
  durationMs: number;
  mode: string;
}

export function recordAICall(event: Omit<AICallEvent, 'id'>): AICallEvent {
  const entry = { ...event, id: `ai-${_nextId++}` };
  _events = [entry, ..._events].slice(0, 100);
  window.dispatchEvent(new CustomEvent('ai-telemetry', { detail: entry }));
  return entry;
}
```

Every `useAI`/`callAI` call records on completion. A dev panel can `addEventListener('ai-telemetry', …)` and show live "Last call: anthropic via OAuth, 2.3s, no fallback."

---

## 8. Setup Checklist for the New Project

### 8a. Required environment variables (Supabase edge function secrets)

| Var                       | Purpose                                              | Required? |
|---------------------------|------------------------------------------------------|-----------|
| `LOVABLE_API_KEY`         | Lovable AI Gateway (Google models + universal fallback) | **Yes**   |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code subscription (preferred Anthropic auth)  | If using Anthropic |
| `ANTHROPIC_API_KEY`       | Paid Anthropic API key (fallback if OAuth fails)     | Optional |
| `OPENAI_API_KEY`          | OpenAI direct                                        | If using OpenAI models |
| `XAI_API_KEY`             | xAI/Grok direct                                      | If using Grok models |

Set them via:
```bash
supabase secrets set LOVABLE_API_KEY=...
supabase secrets set CLAUDE_CODE_OAUTH_TOKEN=...
```

(Or through your hosting provider's dashboard if not using `supabase` CLI.)

### 8b. Required client environment variables (Vite)

| Var                              | Purpose                                  |
|----------------------------------|------------------------------------------|
| `VITE_SUPABASE_URL`              | Supabase project URL                     |
| `VITE_SUPABASE_PUBLISHABLE_KEY`  | Supabase anon/publishable key            |

### 8c. Files to create

1. **`supabase/functions/_shared/provider-router.ts`** — copy from this app verbatim. It's framework-agnostic Deno code.
2. **`supabase/functions/ai-chat/index.ts`** — entry point. Replace the `systemPrompts` map with prompts for *your* product. Everything else stays.
3. **`src/lib/admin-settings.ts`** — model registry, localStorage-backed. Trim `AVAILABLE_MODELS` to the providers you have keys for.
4. **`src/lib/ai-telemetry.ts`** — copy verbatim.
5. **`src/hooks/useAI.ts`** — copy verbatim. Adjust the `mode` default if your product has a different primary mode name.

### 8d. How to obtain a `CLAUDE_CODE_OAUTH_TOKEN`

The token is issued by the Claude Code CLI when you run `claude setup-token` (with an active Claude subscription). Treat it like an API key — keep it server-side only. It rotates; if requests start failing with 401 across both OAuth and API key, the token expired and needs to be regenerated.

### 8e. How to verify it's working

After deployment, send any prompt and check the edge function logs. You should see:

```
[anthropic] model=claude-opus-4-7 auth=oauth
[Sherpa] model=anthropic/claude-opus-4-7 auth=oauth
```

If you see `auth=api_key` after switching to a Claude model, the OAuth token is missing or rejected. If you see `auth=gateway` and `fallback=true`, something failed and you fell back to Lovable/Google — investigate.

---

## 9. Common Pitfalls

| Symptom                                                 | Cause                                                                   |
|---------------------------------------------------------|-------------------------------------------------------------------------|
| Anthropic 401 with valid OAuth token                    | Forgot the Claude Code identity block as `system[0]`                    |
| Anthropic 401 only on the OAuth path                    | Missing `claude-code-20250219` or `oauth-2025-04-20` beta header        |
| Anthropic 400 on Claude 4.7                             | Sent a non-default `temperature`/`top_p`/`top_k` — drop them            |
| Claude 4.6 thinking returns 400 "max_tokens too small"  | Forgot `max_tokens > budget_tokens + 4096` for legacy thinking          |
| Tokens stop arriving 80ms before stream ends            | Final flush not called on `done` / `AbortError` paths                   |
| Telemetry shows `provider: unknown`                     | Edge function isn't prepending the `__telemetry` SSE event              |
| Streaming shows tool-use as raw JSON instead of executing | SSE re-wrap forgot to convert `content_block_stop` → OpenAI tool_calls |
| User selected Claude, got Gemini answer                 | Router incorrectly fell back — Anthropic path must NEVER gateway-fallback |
| 500 "No API keys configured"                            | `LOVABLE_API_KEY` not set; the universal fallback can't run             |

---

## 10. What This Doc Doesn't Cover

- **Tool execution / agent loop.** That's `src/lib/sherpa-agent.ts` and `src/lib/sherpa-tools.ts` — domain-specific. The router supports tools, but how you define and execute them is up to you.
- **Auth (Supabase)**. Standard Supabase auth — see their docs.
- **Streaming UI rendering**. Token batching is in `useAI.ts` but rendering is product-specific.
- **System prompts**. The `systemPrompts` map in `ai-chat/index.ts` is product-specific; replace it.
- **Per-model cost tracking**. Not implemented; telemetry only tracks duration, not tokens.

---

**TL;DR for the receiving Claude:**
> Copy `_shared/provider-router.ts`, `ai-chat/index.ts` (replace prompts), `admin-settings.ts` (trim models), `ai-telemetry.ts`, `useAI.ts`. Set `LOVABLE_API_KEY` + `CLAUDE_CODE_OAUTH_TOKEN`. Done. Anthropic OAuth requires the Claude Code identity in `system[0]` and four beta headers — see §4. The router never falls back from Anthropic to a different model — that's a feature, not a bug.
