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
import { callAI, type ContentPart } from '@/hooks/useAI';
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
  content: string | null | ContentPart[];
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

// Tools that indicate the AI is making forward progress (about to act, not just spinning on reads).
// The stuck loop detector allows these to execute even when emptyTextStreak is high.
const WRITE_TOOLS = new Set([
  'createCard', 'updateCard', 'dissolveCard', 'focusCard',
  'draftEmail', 'createCalendarEvent', 'runSimulation',
  'exportWorkspace', 'createTrigger', 'showAutomations',
  'rememberFact', 'setThreshold', 'suggestNextMoves',
]);

export interface AgentLoopParams {
  query: string;
  workspaceState: WorkspaceState;
  activeContext?: ActiveContext;
  documentIds: string[];
  memories: string;
  /** Base64 data URIs (e.g. "data:image/jpeg;base64,...") attached to this turn */
  images?: string[];
  onStatusUpdate?: (status: string | null) => void;
}

export interface AgentLoopResult {
  response: string;
  actions: any[];
  toolCallsUsed: number;
  nextMoves?: { label: string; query: string }[];
  /** All non-empty intermediate AI texts from each iteration, for reasoning visibility */
  steps?: string[];
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

  // QuickBooks integration hint
  const qboHint = `\nQUICKBOOKS INTEGRATION: QuickBooks Online data is available via the queryQuickBooks tool. Data is cached for the session — repeated calls are instant (no API delay). Available data types:
  - "summary" — full financial snapshot (cash + AR + AP + working capital) in one call
  - "ap" — accounts payable: unpaid bills by vendor with aging buckets
  - "ar" — accounts receivable: open invoices by customer with aging + recent paid history
  - "bank" — bank account and credit card balances
  - "pnl" — profit & loss report (with optional date range)
  - "bill_payments" — bill payment history: vendor, amount, payment method (Check/ACH/CC), which bills paid, with date range option
  - "vendors" — vendor master list
  - "customers" — customer master list
Use this data when the user asks about cash flow, bills, invoices, working capital, vendor performance, customer analysis, or any financial question. Prefer "summary" for broad financial questions. Cross-reference QB data with uploaded spreadsheets when both are relevant.
If the user asks to refresh or update QB data, use the refreshQuickBooks tool to clear the cache and pull fresh data.`;

  const editHint = `\nDATASET EDITING: You can modify uploaded spreadsheets using the editDataset tool. Operations: updateCell, addRow, deleteRow, addColumn, renameColumn.
WORKFLOW: Use queryDataset to read current data → compare with QuickBooks data → use editDataset to propose changes → user confirms via Apply button.
KEY RULES:
  - QuickBooks is ALWAYS READ-ONLY. Never attempt to write to QB.
  - editDataset creates a preview card — changes only apply when the user clicks "Apply Changes".
  - You can add columns the AI finds useful (e.g., "Last QB Sync", "AI Notes", "Payment Status").
  - When reconciling QB data with spreadsheets, always explain what changed and why.
  - Use row indices from queryDataset results. Query first to find the right rows, then edit.`;

  const emailHint = `\nOUTLOOK INTEGRATION: AP email data available via queryEmails tool (requires Outlook sign-in from Context tab).
  - "recent" — latest emails from the Incoa AP Automated folder (vendor invoices, past-due notices, lien threats, payment demands)
  - "search" — search by vendor name, invoice number, or keyword across the mailbox
  - "read" — get full email body by ID (use after recent/search to read a specific email)
Use when the user asks about vendor communications, escalations, "what did [vendor] say?", invoice status, correspondence history, etc.
Cross-reference email data with QuickBooks AP data and the vendor tracker for complete vendor intelligence.
Emails from this folder are auto-forwarded from ap@incoa.com — the actual sender info is often in the forwarded body, not the envelope "from".
Use refreshEmails to clear the cache and pull fresh emails.`;

  const textContent = [
    `User query: "${query}"`,
    focusedHint,
    `\nWorkspace state:\n${structuredContext}`,
    documentsHint,
    qboHint,
    editHint,
    emailHint,
    // NOTE: memories are sent separately as body.memories to the edge function
    // and injected into the system prompt. Don't duplicate them in the user message.
  ].filter(Boolean).join('\n');

  // When images are attached, build a content array so every provider sees them
  const firstMessageContent: string | ContentPart[] = params.images && params.images.length > 0
    ? [
        { type: 'text', text: textContent },
        ...params.images.map(url => ({ type: 'image_url' as const, image_url: { url } })),
      ]
    : textContent;

  const messages: Message[] = [
    ...history,
    { role: 'user', content: firstMessageContent },
  ];

  let toolCallsUsed = 0;
  const pendingWriteActions: any[] = [];
  let capturedNextMoves: { label: string; query: string }[] = [];
  /** All non-empty AI text responses, collected for reasoning visibility */
  const allSteps: string[] = [];

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
    // Show interim thoughts untruncated — user needs to read the full reasoning
    if (iteration > 0) {
      onStatusUpdate?.(bestText || 'Thinking...');
    }

    // Call AI with tools — only inject docs/memories on first iteration
    const response = await callAIWithTools(messages, documentIds, memories, iteration === 0);

    if (!response) {
      return { response: bestText || 'Sherpa could not reach the AI service. Please try again.', actions: remapPendingActions(), toolCallsUsed, nextMoves: capturedNextMoves, steps: allSteps };
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
        nextMoves: capturedNextMoves,
        steps: allSteps,
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
      allSteps.push(text.trim()); // collect every distinct AI reasoning step
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
        nextMoves: capturedNextMoves,
        steps: allSteps,
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
        nextMoves: capturedNextMoves,
        steps: allSteps,
      };
    }

    // Detect stuck loop: if 3+ consecutive iterations have empty text + only READ tool calls,
    // the AI is spinning without making progress. Threshold is 3 (not 2) because a legitimate
    // multi-read workflow (get state → query data → create card) uses 2 read-only iterations
    // before the write call. Breaking at 2 fires too early for those flows.
    // If the current iteration contains a WRITE tool, the AI is about to act — always let it run.
    const hasWriteToolCall = toolCalls.some(tc => WRITE_TOOLS.has(tc.function.name));
    if (emptyTextStreak >= 3 && !hasWriteToolCall) {
      console.warn('[sherpa-agent] Stuck loop detected: 3+ empty iterations with only read tools, breaking out at iteration', iteration);
      onStatusUpdate?.(null);
      const pendingActions = remapPendingActions();
      const finalResponse = bestText || (pendingActions.length > 0 ? 'Done.' : 'I wasn\'t able to complete that. Could you try rephrasing?');
      return {
        response: finalResponse,
        actions: pendingActions,
        toolCallsUsed,
        nextMoves: capturedNextMoves,
        steps: allSteps,
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

      // Check if the tool returned a write action to queue (or next moves to capture)
      try {
        const parsed = JSON.parse(result);
        if (parsed.action === 'nextMoves') {
          // Not a write action — capture suggestions for the caller
          capturedNextMoves = parsed.moves || [];
        } else if (parsed.action) {
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
    nextMoves: capturedNextMoves,
    steps: allSteps,
  };
}

// ─── Multi-Agent Orchestrator ─────────────────────────────────────────────────

/**
 * Heuristic: does this query look complex enough to benefit from parallel workers?
 * We check for multiple intents connected by coordination words.
 */
function looksComplex(query: string): boolean {
  const q = query.toLowerCase();
  const coordinators = [' and also ', ' then ', ' plus ', ' as well as ', ' additionally '];
  const hasCoordinator = coordinators.some(c => q.includes(c));
  // Long AND referencing multiple items OR explicit multi-part request
  const isLong = query.length > 120;
  const hasAnd = /\band\b.*\band\b/i.test(query); // multiple "and"s
  return (hasCoordinator || (isLong && hasAnd));
}

/**
 * Decompose a complex query into focused sub-tasks using AI.
 * Returns 2-3 independent sub-queries the orchestrator can run in parallel.
 */
async function decomposeQuery(
  query: string,
  workspaceContext: string,
  documentIds: string[],
  memories: string,
): Promise<string[]> {
  try {
    const resp = await callAIWithTools(
      [
        {
          role: 'user',
          content: [
            `Decompose the following request into 2-3 focused, independent sub-tasks that can be executed in parallel.`,
            `Each sub-task should be a specific, actionable question or instruction.`,
            `If the request is simple (only 1 logical task), return just that task as-is.`,
            `\nWorkspace context:\n${workspaceContext}`,
            `\nOriginal request: "${query}"`,
            `\nReturn a JSON array of sub-task strings, e.g.: ["task 1", "task 2"]`,
            `Return ONLY the JSON array. No explanation.`,
          ].join('\n'),
        },
      ],
      documentIds,
      memories,
      true,
    );
    if (!resp) return [query];
    const jsonMatch = resp.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const tasks = JSON.parse(jsonMatch[0]);
      if (Array.isArray(tasks) && tasks.every(t => typeof t === 'string')) {
        return tasks.slice(0, 3); // max 3 parallel workers
      }
    }
  } catch {}
  return [query]; // fallback: single task
}

/**
 * Merge results from multiple parallel worker loops.
 * - Combine all actions (create, focus, dissolve, update)
 * - Deduplicate creates with identical titles
 * - Combine responses into a coherent summary
 * - Merge next moves, deduped
 */
function mergeWorkerResults(results: AgentLoopResult[]): AgentLoopResult {
  if (results.length === 0) return { response: 'Done.', actions: [], toolCallsUsed: 0 };
  if (results.length === 1) return results[0];

  const allActions: any[] = [];
  const seenTitles = new Set<string>();
  let totalToolCalls = 0;

  for (const r of results) {
    totalToolCalls += r.toolCallsUsed;
    for (const action of r.actions) {
      // Dedup creates with same title
      if (action.type === 'create') {
        const key = `${action.objectType}:${action.title}`;
        if (seenTitles.has(key)) continue;
        seenTitles.add(key);
      }
      allActions.push(action);
    }
  }

  // Combine response texts — remove duplicates, join with newlines
  const responseParts = results
    .map(r => r.response?.trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i);

  const combinedResponse = responseParts.length > 1
    ? responseParts.join(' ')
    : responseParts[0] || 'Done.';

  // Merge next moves (deduped by label)
  const seenLabels = new Set<string>();
  const nextMoves: { label: string; query: string }[] = [];
  for (const r of results) {
    for (const move of r.nextMoves ?? []) {
      if (!seenLabels.has(move.label)) {
        seenLabels.add(move.label);
        nextMoves.push(move);
      }
    }
  }

  return {
    response: combinedResponse,
    actions: allActions,
    toolCallsUsed: totalToolCalls,
    nextMoves: nextMoves.slice(0, 4),
  };
}

/**
 * Orchestrator loop — for complex multi-intent queries.
 *
 * 1. Decomposes the query into parallel sub-tasks
 * 2. Runs each sub-task as an independent agentLoop (in parallel)
 * 3. Merges results, deduplicating conflicting actions
 * 4. Falls through to a single agentLoop for simple queries
 */
export async function orchestratorLoop(params: AgentLoopParams): Promise<AgentLoopResult> {
  const { query, workspaceState, activeContext, documentIds, memories, onStatusUpdate } = params;

  // Only fan out for genuinely complex queries — single loop is faster otherwise
  if (!looksComplex(query)) {
    return agentLoop(params);
  }

  onStatusUpdate?.('Decomposing complex request...');

  // Build context for decomposition
  const ds = getActiveDataset();
  const profile = getCurrentProfile(ds.columns, ds.rows);
  const workspaceContext = buildWorkspaceIntentContext({
    objects: workspaceState.objects,
    activeContext,
    profile,
  });

  const subTasks = await decomposeQuery(query, workspaceContext, documentIds, memories);

  // If decomposition returned a single task, just run the normal agent
  if (subTasks.length <= 1) {
    return agentLoop(params);
  }

  console.log(`[orchestrator] Fanning out to ${subTasks.length} parallel workers:`, subTasks);
  onStatusUpdate?.(`Running ${subTasks.length} parallel analyses...`);

  // Run all workers in parallel
  const workerPromises = subTasks.map((subQuery, i) =>
    agentLoop({
      ...params,
      query: subQuery,
      onStatusUpdate: (status) => {
        if (status) onStatusUpdate?.(`[Worker ${i + 1}] ${status}`);
      },
    })
  );

  const workerResults = await Promise.all(workerPromises);
  onStatusUpdate?.('Synthesizing results...');

  const merged = mergeWorkerResults(workerResults);
  console.log(`[orchestrator] Merged: ${merged.actions.length} actions, ${merged.toolCallsUsed} tool calls`);

  return merged;
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
    mode: 'agent',
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
  const timeout = setTimeout(() => controller.abort(), 180000); // 180s for agent calls (QB queries add latency)
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

/**
 * Extract text and tool calls from an SSE-formatted response.
 *
 * Tool call arguments arrive across multiple streaming delta chunks — we must
 * accumulate all fragments before returning. Returning on the first delta chunk
 * (the old behavior) gave parseAgentResponse empty/partial arguments, so
 * executeTool was called with {} and produced useless results, ending the loop.
 */
function extractFromSSE(sse: string): string {
  let textResult = '';
  const toolCallAccumulator: Record<number, { id: string; name: string; arguments: string }> = {};
  let hasStreamingToolCalls = false;

  for (const line of sse.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const json = line.slice(6).trim();
    if (json === '[DONE]') continue;
    try {
      const parsed = JSON.parse(json);
      if (parsed.__telemetry) continue;

      // Accumulate text content
      const content = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
      if (content) textResult += content;

      // Complete tool calls in a single chunk (Anthropic-transformed format from provider-router)
      const msgToolCalls = parsed.choices?.[0]?.message?.tool_calls;
      if (Array.isArray(msgToolCalls) && msgToolCalls.length > 0) {
        return JSON.stringify(parsed); // already fully assembled
      }

      // Streaming tool call deltas (Google/OpenAI streaming format) — accumulate across chunks
      const deltaToolCalls = parsed.choices?.[0]?.delta?.tool_calls;
      if (Array.isArray(deltaToolCalls)) {
        hasStreamingToolCalls = true;
        for (const tc of deltaToolCalls) {
          const idx = tc.index ?? 0;
          if (!toolCallAccumulator[idx]) {
            toolCallAccumulator[idx] = { id: '', name: '', arguments: '' };
          }
          if (tc.id) toolCallAccumulator[idx].id = tc.id;
          if (tc.function?.name) toolCallAccumulator[idx].name = tc.function.name;
          if (tc.function?.arguments) toolCallAccumulator[idx].arguments += tc.function.arguments;
        }
      }
    } catch {}
  }

  // If we accumulated streaming tool calls, assemble and return them as a complete message
  if (hasStreamingToolCalls && Object.keys(toolCallAccumulator).length > 0) {
    const completedToolCalls = Object.values(toolCallAccumulator).map(tc => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.name, arguments: tc.arguments },
    }));
    return JSON.stringify({
      choices: [{
        message: { role: 'assistant', content: textResult || null, tool_calls: completedToolCalls },
        finish_reason: 'tool_calls',
        index: 0,
      }],
    });
  }

  return textResult;
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
