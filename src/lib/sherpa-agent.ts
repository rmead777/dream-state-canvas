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

  // Build focused card context
  const focusedId = activeContext?.focusedObjectId;
  const focusedObj = focusedId ? workspaceState.objects[focusedId] : null;
  let focusedHint = '';
  if (focusedObj) {
    const rowCount = Array.isArray(focusedObj.context?.rows) ? focusedObj.context.rows.length : null;
    focusedHint = `\nFOCUSED CARD: "${focusedObj.title}" (${focusedObj.type}, ID: ${focusedObj.id}, ${rowCount !== null ? `${rowCount} rows` : 'no data'})`;
  }

  // Build workspace summary
  const activeObjects = Object.values(workspaceState.objects)
    .filter(o => o.status !== 'dissolved')
    .sort((a, b) => b.lastInteractedAt - a.lastInteractedAt)
    .slice(0, 8);
  const workspaceSummary = activeObjects.length > 0
    ? `\nWORKSPACE: ${activeObjects.map(o => `${o.id}|${o.type}|"${o.title}"${o.id === focusedId ? ' [FOCUSED]' : ''}`).join(', ')}`
    : '\nWORKSPACE: empty';

  const messages: Message[] = [
    ...history,
    {
      role: 'user',
      content: [
        `User query: "${query}"`,
        focusedHint,
        workspaceSummary,
        memories ? `\n${memories}` : '',
      ].filter(Boolean).join('\n'),
    },
  ];

  let toolCallsUsed = 0;
  const pendingWriteActions: any[] = [];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    onStatusUpdate?.(iteration > 0 ? 'Thinking...' : null);

    // Call AI with tools
    const response = await callAIWithTools(messages, documentIds, memories);

    if (!response) {
      return { response: 'Sherpa could not reach the AI service. Please try again.', actions: [], toolCallsUsed };
    }

    // Parse the response — check for tool calls
    const { text, toolCalls, rawActions } = parseAgentResponse(response);

    // If AI returned actions directly (the normal intent-parsing path), return them
    if (rawActions && rawActions.length > 0) {
      onStatusUpdate?.(null);
      return {
        response: text || 'Done.',
        actions: [...rawActions, ...pendingWriteActions.map(a => a)],
        toolCallsUsed,
      };
    }

    // If no tool calls, we're done
    if (!toolCalls || toolCalls.length === 0) {
      onStatusUpdate?.(null);
      return {
        response: text || 'I processed your request.',
        actions: pendingWriteActions,
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

      const result = await executeTool(toolName, args, workspaceState);

      // Check if the tool returned a write action to queue
      try {
        const parsed = JSON.parse(result);
        if (parsed.action) {
          pendingWriteActions.push(parsed);
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
    actions: pendingWriteActions,
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

    if (!resp.ok) return null;

    // Non-streaming: read full JSON response
    const text = await resp.text();

    // If the response is SSE format (edge function didn't respect stream:false),
    // extract the content from the SSE lines
    if (text.startsWith('data: ')) {
      return extractFromSSE(text);
    }

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
 */
function parseAgentResponse(response: string): {
  text: string;
  toolCalls: ToolCall[] | null;
  rawActions: any[] | null;
} {
  // Try parsing as JSON first (non-streaming response or extracted from SSE)
  try {
    const parsed = JSON.parse(response);

    // OpenAI format: choices[0].message
    if (parsed.choices?.[0]?.message) {
      const msg = parsed.choices[0].message;
      return {
        text: msg.content || '',
        toolCalls: msg.tool_calls || null,
        rawActions: null,
      };
    }

    // Direct JSON response from the AI (intent format: { response, actions })
    if (parsed.response !== undefined || parsed.actions !== undefined) {
      return {
        text: parsed.response || '',
        toolCalls: null,
        rawActions: parsed.actions || null,
      };
    }
  } catch {}

  // Plain text — try to extract JSON from it (the current parseIntentAI pattern)
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        text: parsed.response || '',
        toolCalls: null,
        rawActions: parsed.actions || null,
      };
    } catch {}
  }

  // Plain text response with no JSON — treat as conversational
  return { text: response, toolCalls: null, rawActions: null };
}
