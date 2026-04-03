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
import { recordAICall, extractRouteMeta } from './ai-telemetry';

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_call_id?: string;
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

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    onStatusUpdate?.(iteration > 0 ? 'Thinking...' : null);

    // Call AI with tools
    const response = await callAIWithTools(messages, documentIds, memories);

    if (!response) {
      return { response: 'Sherpa could not reach the AI service. Please try again.', actions: [], toolCallsUsed };
    }

    // Parse the response — check for tool calls
    const { text, toolCalls, rawActions } = parseAgentResponse(response);
    console.log('[sherpa-agent] Iteration', iteration, '| text:', text?.slice(0, 80), '| toolCalls:', toolCalls?.length || 0, '| rawActions:', rawActions?.length || 0, '| raw response length:', response.length);

    // If AI returned actions directly (the normal intent-parsing path), return them
    if (rawActions && rawActions.length > 0) {
      onStatusUpdate?.(null);
      return {
        response: text || 'Done.',
        actions: [...rawActions, ...remapPendingActions()],
        toolCallsUsed,
      };
    }

    // If no tool calls, we're done
    if (!toolCalls || toolCalls.length === 0) {
      onStatusUpdate?.(null);
      return {
        response: text || 'I processed your request.',
        actions: remapPendingActions(),
        toolCallsUsed,
      };
    }

    // Push ONE assistant message with the tool calls (before executing them)
    messages.push({
      role: 'assistant',
      content: text || '',
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

  // Max iterations reached
  onStatusUpdate?.(null);
  return {
    response: 'I\'ve gathered what I can. Here\'s what I found.',
    actions: remapPendingActions(),
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
  if (documentIds.length > 0) body.documentIds = documentIds;
  if (memories) body.memories = memories;
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

    // Extract routing metadata for telemetry
    const routeMeta = extractRouteMeta(resp);

    if (!resp.ok) return null;

    // Non-streaming: read full JSON response
    const text = await resp.text();

    // Record telemetry
    recordAICall({
      timestamp: Date.now(),
      model: routeMeta.model,
      provider: routeMeta.provider,
      billing: routeMeta.billing,
      fallback: routeMeta.fallback,
      durationMs: Date.now() - callStartTime,
      mode: 'intent',
      toolCalls: body.tools ? 1 : 0,
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
  const trimmed = response.trim();

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
    // It may also have a random prefix like "vitamins" before the JSON
    if (typeof text === 'string') {
      // Find the first { in the content
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

    // Anthropic text might itself be JSON (the intent response), possibly with a prefix
    let text = textBlock?.text || '';
    let rawActions: any[] | null = null;
    const jsonIdx = text.indexOf('{');
    if (jsonIdx >= 0) {
      try {
        const innerParsed = JSON.parse(text.slice(jsonIdx));
        if (innerParsed.response !== undefined) {
          text = innerParsed.response || '';
          rawActions = innerParsed.actions || null;
        }
      } catch {}
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
