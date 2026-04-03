/**
 * Sherpa Agent — multi-turn tool-using agent loop.
 *
 * Instead of single-turn intent parsing, the agent can:
 * 1. Receive a query
 * 2. Call tools to read data, check workspace state, search
 * 3. Get tool results
 * 4. Decide: need more tools? or ready to respond?
 * 5. Loop up to N iterations
 * 6. Return final response + actions
 *
 * The loop runs client-side. Each AI call goes through the edge function.
 * Tools execute in the browser reading from React state + Supabase.
 */
import { callAI } from '@/hooks/useAI';
import { SHERPA_TOOLS, executeTool, getToolStatus } from './sherpa-tools';
import { WorkspaceState, WorkspaceAction, ActiveContext } from './workspace-types';
import { getConversationMessages } from './conversation-memory';
import { getAdminSettings } from './admin-settings';
import { listDocuments } from './document-store';
import { buildWorkspaceIntentContext } from './workspace-intelligence';
import { getCurrentProfile } from './data-analyzer';
import { getActiveDataset } from './active-dataset';
import { recordAICall, defaultRouteMeta, parseRouteMeta } from './ai-telemetry';

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentLoopParams {
  query: string;
  workspaceState: WorkspaceState;
  activeContext?: ActiveContext;
  documentIds: string[];
  memories: string;
  onStatusUpdate?: (status: string | null) => void;
}

export interface AgentLoopResult {
  response: string;
  actions: any[];
  toolCallsUsed: number;
}

/**
 * Run the agent loop. Returns the same { response, actions } shape
 * as parseIntentAI so applyResult() works unchanged downstream.
 */
export async function agentLoop(params: AgentLoopParams): Promise<AgentLoopResult> {
  const { query, workspaceState, activeContext, documentIds, memories, onStatusUpdate } = params;
  const { contextWindow } = getAdminSettings();
  const maxIterations = getAdminSettings().agentMaxIterations || 5;

  // Build conversation history
  const history = getConversationMessages(contextWindow);

  // Build structured workspace context using the same pipeline as the old intent engine.
  // This includes: DataProfile summary, focused object details, per-object summaries
  // with view state, recent intent outcomes — all compressed for the context window.
  const ds = getActiveDataset();
  const profile = getCurrentProfile(ds.columns, ds.rows);
  const structuredContext = buildWorkspaceIntentContext({
    objects: workspaceState.objects,
    activeContext,
    profile,
  });

  // Focused card behavioral hint — tells the AI when to update vs create
  const focusedId = activeContext?.focusedObjectId;
  const focusedObj = focusedId ? workspaceState.objects[focusedId] : null;
  let focusedHint = '';
  if (focusedObj) {
    focusedHint = `\nFOCUSED CARD: "${focusedObj.title}" (${focusedObj.type}, ID: ${focusedObj.id})\nNOTE: Only use "update" on this card if the user EXPLICITLY references it ("this card", "that table", "show 5 rows"). General questions like "help me visualize" or "what should I do" should CREATE a new card, not update the focused one.`;
  }

  // Uploaded documents list so the AI knows what's available for getDocumentContent tool
  let documentsHint = '';
  try {
    const docs = await listDocuments();
    if (docs.length > 0) {
      documentsHint = `\nUPLOADED DOCUMENTS (use getDocumentContent tool to read any of these):\n${docs.map(d => `  - ID: ${d.id} | "${d.filename}" (${d.file_type}) | uploaded ${d.created_at}`).join('\n')}`;
    }
  } catch {}

  const messages: Message[] = [
    ...history,
    {
      role: 'user',
      content: [
        `User query: "${query}"`,
        focusedHint,
        `\nWorkspace state:\n${structuredContext}`,
        documentsHint,
        memories ? `\n${memories}` : '',
      ].filter(Boolean).join('\n'),
    },
  ];

  let toolCallsUsed = 0;
  const pendingWriteActions: any[] = [];

  /** Remap tool executor output to applyResult format: { action: 'create' } → { type: 'create' } */
  function remapPendingActions(): any[] {
    return pendingWriteActions.map(a => {
      const { action, ...rest } = a;
      return { type: action, ...rest };
    });
  }

  // Shadow state: mutable copy of workspace objects so write tools are
  // visible to subsequent read tools within the same loop iteration.
  // After the loop, pendingWriteActions are applied to real React state.
  const shadowObjects = { ...workspaceState.objects };
  const shadowState: WorkspaceState = { ...workspaceState, objects: shadowObjects };

  // Track best response text across iterations — earlier iterations often have
  // good explanatory text that gets lost when the loop continues with tool calls
  let bestText = '';
  let emptyTextStreak = 0; // Detect stuck loops: consecutive iterations with no text
  let firstProvider = ''; // Detect provider switches mid-loop

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Show interim thoughts (not just "Thinking...")
    if (iteration > 0) {
      onStatusUpdate?.(bestText ? `● ${bestText.slice(0, 100)}...` : 'Thinking...');
    }

    // Call AI with tools — only inject docs/memories on first iteration
    const response = await callAIWithTools(messages, documentIds, memories, iteration === 0);

    if (!response) {
      return { response: bestText || 'Sherpa could not reach the AI service. Please try again.', actions: remapPendingActions(), toolCallsUsed };
    }

    // Detect which provider responded (Anthropic starts with {"model":, Google with {"id":"gen-)
    const responseProvider = response.startsWith('{"model":"claude') ? 'anthropic'
      : response.startsWith('{"id":"gen-') ? 'google' : 'unknown';
    if (iteration === 0) {
      firstProvider = responseProvider;
    } else if (firstProvider && responseProvider !== 'unknown' && responseProvider !== firstProvider) {
      // Provider switched mid-loop — the new provider can't understand the tool conversation
      console.warn(`[sherpa-agent] Provider switch detected: ${firstProvider} → ${responseProvider} at iteration ${iteration}. Breaking loop.`);
      onStatusUpdate?.(null);
      const pendingActions = remapPendingActions();
      return {
        response: bestText || (pendingActions.length > 0 ? 'Done.' : 'The AI provider was rate-limited mid-task. Try again in a moment.'),
        actions: pendingActions,
        toolCallsUsed,
      };
    }

    // Parse the response — check for tool calls
    let { text, toolCalls, rawActions } = parseAgentResponse(response);
    console.log('[sherpa-agent] Iteration', iteration, '| provider:', responseProvider, '| text:', JSON.stringify(text?.slice(0, 120)), '| toolCalls:', toolCalls?.length || 0, '| rawActions:', rawActions?.length || 0, '| raw response length:', response.length);

    // Safety net: if text still contains leaked intent JSON, extract clean response
    const cleaned = cleanResponseText(text);
    if (cleaned.text !== text) {
      console.log('[sherpa-agent] cleanResponseText changed text from', JSON.stringify(text?.slice(0, 80)), 'to', JSON.stringify(cleaned.text?.slice(0, 80)), '| extracted actions:', cleaned.actions?.length || 0);
      text = cleaned.text;
      if (cleaned.actions && cleaned.actions.length > 0) {
        rawActions = [...(rawActions || []), ...cleaned.actions];
      }
    }

    // Preserve the best (most recent non-empty) response text across iterations
    if (text && text.trim()) {
      bestText = text;
      emptyTextStreak = 0;
    } else {
      emptyTextStreak++;
    }

    // If AI returned actions directly (the normal intent-parsing path), return them
    if (rawActions && rawActions.length > 0) {
      onStatusUpdate?.(null);
      const finalResponse = bestText || (rawActions.some(a => a.type === 'update') ? 'Updated.' : 'Done.');
      console.log('[sherpa-agent] Returning with', rawActions.length, 'actions, response:', JSON.stringify(finalResponse.slice(0, 80)));
      return {
        response: finalResponse,
        actions: [...rawActions, ...remapPendingActions()],
        toolCallsUsed,
      };
    }

    // If no tool calls, we're done
    if (!toolCalls || toolCalls.length === 0) {
      onStatusUpdate?.(null);
      const pendingActions = remapPendingActions();
      const fallback = pendingActions.length > 0
        ? (pendingActions.some(a => a.type === 'update') ? 'Updated.' : 'Done.')
        : '';
      const finalResponse = bestText || fallback || 'Done.';
      console.log('[sherpa-agent] Returning no-tool-call path, response:', JSON.stringify(finalResponse.slice(0, 80)), '| pendingActions:', pendingActions.length);
      return {
        response: finalResponse,
        actions: pendingActions,
        toolCallsUsed,
      };
    }

    // Detect stuck loop: if 2+ consecutive iterations have empty text + only tool calls,
    // the AI is spinning without making progress. Break out and return what we have.
    if (emptyTextStreak >= 2 && iteration >= 2) {
      console.warn('[sherpa-agent] Stuck loop detected: 2+ empty iterations, breaking out at iteration', iteration);
      onStatusUpdate?.(null);
      const pendingActions = remapPendingActions();
      const finalResponse = bestText || (pendingActions.length > 0 ? 'Done.' : 'I wasn\'t able to complete that. Could you try rephrasing?');
      return {
        response: finalResponse,
        actions: pendingActions,
        toolCallsUsed,
      };
    }

    // Push assistant message WITH the tool_calls field — required by the API spec.
    // Without tool_calls here, subsequent tool result messages are orphaned and the
    // AI cannot match them to a call, causing it to re-call the same tool every iteration.
    messages.push({
      role: 'assistant',
      content: text || null,
      tool_calls: toolCalls,
    });

    // Execute tool calls and push results
    for (const tc of toolCalls) {
      toolCallsUsed++;
      const toolName = tc.function.name;
      onStatusUpdate?.(getToolStatus(toolName));

      let args: Record<string, any> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }

      const result = await executeTool(toolName, args, shadowState);

      // Check if the tool returned a write action to queue
      try {
        const parsed = JSON.parse(result);
        if (parsed.action) {
          pendingWriteActions.push(parsed);

          // Apply to shadow state so subsequent read tools see the change
          if (parsed.action === 'create' && parsed.objectType && parsed.title) {
            const id = `wo-${Date.now()}-${toolCallsUsed}`;
            // Store the ID in the pending action so handleCreate uses it
            parsed.id = id;
            shadowObjects[id] = {
              id,
              type: parsed.objectType,
              title: parsed.title,
              status: 'open',
              pinned: false,
              origin: { type: 'system' as any, query: '' },
              relationships: [],
              context: parsed.sections ? { sections: parsed.sections } : (parsed.dataQuery ? { dataQuery: parsed.dataQuery } : {}),
              position: { zone: 'primary', order: 0 },
              createdAt: Date.now(),
              lastInteractedAt: Date.now(),
            } as any;
          } else if (parsed.action === 'dissolve' && parsed.objectId && shadowObjects[parsed.objectId]) {
            shadowObjects[parsed.objectId] = { ...shadowObjects[parsed.objectId], status: 'dissolved' as any };
          } else if (parsed.action === 'update' && parsed.objectId && shadowObjects[parsed.objectId]) {
            const obj = shadowObjects[parsed.objectId];
            shadowObjects[parsed.objectId] = {
              ...obj,
              context: {
                ...obj.context,
                ...(parsed.dataQuery ? { dataQuery: parsed.dataQuery } : {}),
                ...(parsed.sections ? { sections: parsed.sections } : {}),
              },
              ...(parsed.title ? { title: parsed.title } : {}),
            } as any;
          }
        }
      } catch {}

      // Add tool result
      messages.push({
        role: 'tool',
        content: result,
        tool_call_id: tc.id,
      });
    }
  }

  // Max iterations reached — use best text from any iteration
  onStatusUpdate?.(null);
  const pendingActions = remapPendingActions();
  const maxIterFallback = pendingActions.length > 0
    ? (pendingActions.some(a => a.type === 'update') ? 'Updated.' : 'Done.')
    : 'I\'ve gathered what I can.';
  return {
    response: bestText || maxIterFallback,
    actions: pendingActions,
    toolCallsUsed,
  };
}

/**
 * Call the AI with tool definitions.
 * The edge function passes tools to the provider.
 */
async function callAIWithTools(
  messages: Message[],
  documentIds: string[],
  memories: string,
  isFirstIteration: boolean = true,
): Promise<string | null> {
  // We need a non-streaming call that returns the full response including tool_calls.
  // The current callAI streams SSE. For tool calling, we need the full JSON response.
  // Solution: add a `stream: false` option to the edge function call.

  const admin = getAdminSettings();
  const { getPromptOverride } = await import('./system-prompts');
  const { supabase } = await import('@/integrations/supabase/client');

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const body: Record<string, unknown> = {
    messages,
    mode: 'intent',
    stream: false, // Non-streaming for tool calling
    tools: SHERPA_TOOLS,
  };
  // Only inject documents and memories on the first iteration.
  // Subsequent iterations already have document context from the initial system prompt
  // carried in the messages array — re-sending documentIds causes the edge function to
  // re-fetch and re-inject full document content every call, inflating request size.
  if (isFirstIteration && documentIds.length > 0) body.documentIds = documentIds;
  if (isFirstIteration && memories) body.memories = memories;
  if (admin.isUnlocked) {
    body.adminModel = admin.model;
    body.adminMaxTokens = admin.maxTokens;
  }
  const promptOverride = getPromptOverride('intent');
  if (promptOverride) body.promptOverride = promptOverride;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000); // 60s for agent calls
  const callStartTime = Date.now();

  try {
    const resp = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );

    let routeMeta = defaultRouteMeta();
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let actualToolCallCount = 0;

    if (!resp.ok) return null;

    // Non-streaming: read full JSON response
    let text = await resp.text();

    // Try to extract __telemetry and token usage from the JSON body
    try {
      const bodyParsed = JSON.parse(text);
      if (bodyParsed.__telemetry) {
        routeMeta = parseRouteMeta(bodyParsed.__telemetry);
        if (bodyParsed.__raw !== undefined) {
          text = bodyParsed.__raw;
        } else {
          delete bodyParsed.__telemetry;
          text = JSON.stringify(bodyParsed);
        }
      } else if (bodyParsed.model) {
        // Raw Anthropic response — extract model and usage
        routeMeta.model = `anthropic/${bodyParsed.model}`;
        routeMeta.provider = 'anthropic';
      }
      // Extract token usage (Anthropic: usage.input_tokens/output_tokens, OpenAI: usage.prompt_tokens/completion_tokens)
      if (bodyParsed.usage) {
        inputTokens = bodyParsed.usage.input_tokens ?? bodyParsed.usage.prompt_tokens;
        outputTokens = bodyParsed.usage.output_tokens ?? bodyParsed.usage.completion_tokens;
      }
      // Count actual tool calls the AI invoked in this response
      const msgToolCalls = bodyParsed.choices?.[0]?.message?.tool_calls;
      if (Array.isArray(msgToolCalls)) {
        actualToolCallCount = msgToolCalls.length;
      } else {
        // Anthropic format: content blocks of type tool_use
        const contentBlocks = bodyParsed.content;
        if (Array.isArray(contentBlocks)) {
          actualToolCallCount = contentBlocks.filter((b: any) => b.type === 'tool_use').length;
        }
      }
    } catch {
      // Not JSON — will be handled below as SSE
    }

    // Record telemetry
    recordAICall({
      timestamp: Date.now(),
      model: routeMeta.model,
      provider: routeMeta.provider,
      authMode: routeMeta.authMode,
      fallback: routeMeta.fallback,
      durationMs: Date.now() - callStartTime,
      mode: 'intent',
      toolCalls: actualToolCallCount,
      inputTokens,
      outputTokens,
      requestPayload: body,
    });

    // If the response is SSE format (edge function didn't respect stream:false),
    // extract the content from the SSE lines
    if (text.startsWith('data: ')) {
      const extracted = extractFromSSE(text);
      console.log('[callAIWithTools] SSE extracted, length:', extracted.length, 'starts:', extracted.slice(0, 60));
      return extracted;
    }

    console.log('[callAIWithTools] Non-SSE response, length:', text.length, 'starts:', text.slice(0, 60));
    return text;
  } catch (err) {
    console.error('[sherpa-agent] AI call failed:', err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Extract full text from SSE-formatted response */
function extractFromSSE(sse: string): string {
  let result = '';
  for (const line of sse.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const json = line.slice(6).trim();
    if (json === '[DONE]') continue;
    try {
      const parsed = JSON.parse(json);

      // Skip telemetry events in SSE stream
      if (parsed.__telemetry) continue;

      const content = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.message?.content;
      if (content) result += content;

      // Check for tool calls in the response
      const toolCalls = parsed.choices?.[0]?.delta?.tool_calls || parsed.choices?.[0]?.message?.tool_calls;
      if (toolCalls) {
        // Return the full parsed object as JSON so parseAgentResponse can extract tool calls
        return JSON.stringify(parsed);
      }
    } catch {}
  }
  return result;
}

/** Strip markdown code fences (```json ... ```) that AI models love to add around JSON */
function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

/**
 * Final safety net: if the response text still contains intent JSON,
 * extract the clean "response" field. Catches all edge cases where
 * earlier parsing stages fail due to formatting variations.
 */
function cleanResponseText(text: string): { text: string; actions: any[] | null } {
  if (!text) return { text, actions: null };

  // Fast check: does it look like it might contain intent JSON?
  // Must have both "response" key AND "actions" key to be intent JSON
  if (!text.includes('"response"') || !text.includes('"actions"')) return { text, actions: null };

  // Try to find intent JSON anywhere in the text (with or without code fences)
  const stripped = stripCodeFences(text);

  // Direct parse
  try {
    const parsed = JSON.parse(stripped);
    if (parsed.response !== undefined) {
      console.log('[cleanResponseText] Extracted response from direct JSON parse');
      return { text: parsed.response, actions: parsed.actions || null };
    }
  } catch {}

  // Find JSON object within the text
  const jsonMatch = stripped.match(/\{[\s\S]*"response"\s*:\s*"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.response !== undefined) {
        console.log('[cleanResponseText] Extracted response via regex match');
        return { text: parsed.response, actions: parsed.actions || null };
      }
    } catch {}
  }

  // Regex extraction of just the response field value
  const responseMatch = text.match(/"response"\s*:\s*"((?:[^"\\]|\\[\s\S])*)"/);
  if (responseMatch) {
    const extracted = responseMatch[1]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\');
    // Also try to grab actions
    const actionsMatch = text.match(/"actions"\s*:\s*(\[[\s\S]*?\])\s*\}?\s*(?:```)?$/);
    let actions: any[] | null = null;
    if (actionsMatch) {
      try { actions = JSON.parse(actionsMatch[1]); } catch {}
    }
    console.log('[cleanResponseText] Extracted response via field regex');
    return { text: extracted, actions };
  }

  return { text, actions: null };
}

/**
 * Parse AI response — extract text, tool calls, and/or actions.
 * Handles: OpenAI JSON, Anthropic JSON, intent JSON, SSE-assembled text, plain text.
 * MUST be extremely robust — any failure here means raw JSON shows in the chat.
 */
function parseAgentResponse(response: string): {
  text: string;
  toolCalls: ToolCall[] | null;
  rawActions: any[] | null;
} {
  const trimmed = stripCodeFences(response.trim());

  // 1. Try direct JSON parse
  try {
    const parsed = JSON.parse(trimmed);
    const result = extractFromParsedJSON(parsed);
    if (result) {
      console.log('[parseAgentResponse] Parsed directly as JSON');
      return result;
    }
  } catch (e) {
    console.log('[parseAgentResponse] Direct JSON.parse failed:', (e as Error).message?.slice(0, 80));
  }

  // 2. Try extracting JSON from within the text (AI may wrap in markdown or have prefix)
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const result = extractFromParsedJSON(parsed);
      if (result) {
        console.log('[parseAgentResponse] Parsed via regex extraction');
        return result;
      }
    } catch {}
  }

  // 3. Safety net — if the text contains "response" and "actions", it's almost certainly
  // intent JSON that we failed to parse. Log it clearly so we can debug.
  if (trimmed.includes('"response"') && trimmed.includes('"actions"')) {
    console.error('[parseAgentResponse] LIKELY UNPARSED JSON — this should not reach the user as raw text:', trimmed.slice(0, 200));
    // Last-ditch: try to extract just the response field with regex
    const responseMatch = trimmed.match(/"response"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (responseMatch) {
      const extractedText = responseMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
      // Try to find actions array
      const actionsMatch = trimmed.match(/"actions"\s*:\s*(\[[\s\S]*\])/);
      let actions: any[] | null = null;
      if (actionsMatch) {
        try { actions = JSON.parse(actionsMatch[1]); } catch {}
      }
      console.log('[parseAgentResponse] Regex-extracted response text + actions');
      return { text: extractedText, toolCalls: null, rawActions: actions };
    }
  }

  // 4. Plain text response — treat as conversational
  console.log('[parseAgentResponse] Treating as plain text');
  return { text: trimmed, toolCalls: null, rawActions: null };
}

/** Extract text/toolCalls/actions from a parsed JSON object */
function extractFromParsedJSON(parsed: any): {
  text: string;
  toolCalls: ToolCall[] | null;
  rawActions: any[] | null;
} | null {
  // OpenAI format: choices[0].message
  if (parsed.choices?.[0]?.message) {
    const msg = parsed.choices[0].message;
    let text = msg.content || '';
    let rawActions: any[] | null = null;

    // msg.content might be a JSON string (double-wrapped: the AI returns intent JSON as content)
    // It may also have a random prefix or markdown code fences
    if (typeof text === 'string') {
      text = stripCodeFences(text);
      const jsonStart = text.indexOf('{');
      if (jsonStart >= 0) {
        const jsonCandidate = text.slice(jsonStart).trim();
        try {
          const inner = JSON.parse(jsonCandidate);
          if (inner.response !== undefined) {
            text = inner.response || '';
            rawActions = inner.actions || null;
            console.log('[extractFromParsedJSON] Inner JSON parsed — text:', text.slice(0, 60), 'actions:', rawActions?.length || 0);
          }
        } catch (e) {
          console.warn('[extractFromParsedJSON] Inner JSON parse failed:', (e as Error).message?.slice(0, 80));
          // Last resort: regex
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const inner = JSON.parse(jsonMatch[0]);
              if (inner.response !== undefined) {
                text = inner.response || '';
                rawActions = inner.actions || null;
              }
            } catch {}
          }
        }
      }
    }

    // If inner JSON extraction failed but text still looks like intent JSON, try cleanResponseText
    if (!rawActions && typeof text === 'string' && text.includes('"response"') && text.includes('"actions"')) {
      const fallback = cleanResponseText(text);
      if (fallback.text !== text) {
        console.log('[extractFromParsedJSON] OpenAI: cleanResponseText recovered response');
        text = fallback.text;
        rawActions = fallback.actions;
      }
    }

    return {
      text,
      toolCalls: msg.tool_calls || null,
      rawActions,
    };
  }

  // Anthropic format: content array with text and tool_use blocks
  if (Array.isArray(parsed.content)) {
    const textBlock = parsed.content.find((b: any) => b.type === 'text');
    const toolBlocks = parsed.content.filter((b: any) => b.type === 'tool_use');

    // Anthropic text might itself be JSON (the intent response), possibly wrapped in code fences
    let text = stripCodeFences(textBlock?.text || '');
    let rawActions: any[] | null = null;
    const jsonIdx = text.indexOf('{');
    if (jsonIdx >= 0) {
      try {
        const innerParsed = JSON.parse(text.slice(jsonIdx));
        if (innerParsed.response !== undefined) {
          text = innerParsed.response || '';
          rawActions = innerParsed.actions || null;
        }
      } catch {
        // Try greedy regex match (handles trailing garbage)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const inner = JSON.parse(jsonMatch[0]);
            if (inner.response !== undefined) {
              text = inner.response || '';
              rawActions = inner.actions || null;
            }
          } catch {}
        }
      }
    }

    // If inner JSON extraction failed but text still looks like intent JSON, try cleanResponseText
    if (!rawActions && text.includes('"response"') && text.includes('"actions"')) {
      const fallback = cleanResponseText(text);
      if (fallback.text !== text) {
        console.log('[extractFromParsedJSON] Anthropic: cleanResponseText recovered response');
        text = fallback.text;
        rawActions = fallback.actions;
      }
    }

    const toolCalls = toolBlocks.length > 0
      ? toolBlocks.map((b: any) => ({
          id: b.id,
          type: 'function' as const,
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        }))
      : null;

    return { text, toolCalls, rawActions };
  }

  // Direct intent format: { response, actions }
  if (parsed.response !== undefined || parsed.actions !== undefined) {
    return {
      text: parsed.response || '',
      toolCalls: null,
      rawActions: parsed.actions || null,
    };
  }

  return null;
}
