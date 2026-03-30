/**
 * Conversation Memory — maintains session conversation history for Sherpa.
 *
 * Stores user queries and AI responses as message pairs.
 * The intent engine pulls the last N turns (configurable via admin settings)
 * so the AI can handle follow-ups, references, and context-dependent queries.
 */

export interface ConversationTurn {
  query: string;
  response: string | null;
  timestamp: number;
}

const STORAGE_KEY = 'sherpa-conversation';

let _turns: ConversationTurn[] = [];

// Restore from localStorage on init
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    _turns = JSON.parse(stored);
  }
} catch (e) { console.warn('[conversation-memory] Failed to restore:', e); }

function persist() {
  try {
    // Keep at most 100 turns in storage to avoid bloat
    const toStore = _turns.slice(-100);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch (e) { console.warn('[conversation-memory] Failed to persist:', e); }
}

/** Record a user query (response will be updated when AI replies) */
export function addQuery(query: string): void {
  _turns.push({ query, response: null, timestamp: Date.now() });
  persist();
}

/** Update the response for the most recent query */
export function updateLastResponse(response: string): void {
  if (_turns.length > 0) {
    _turns[_turns.length - 1].response = response;
    persist();
  }
}

/** Rough token estimate — ~4 chars per token for English text */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Get the last N turns as AI message pairs, capped by token budget.
 *  Token budget prevents conversation history from crowding out workspace
 *  context and memory in the AI's context window. Default: ~3000 tokens. */
export function getConversationMessages(
  n: number,
  maxTokens: number = 3000
): { role: 'user' | 'assistant'; content: string }[] {
  const recent = _turns.slice(-n);
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];

  // Build from most recent backward, stop when budget is exhausted
  let tokenBudget = maxTokens;
  const pairs: { role: 'user' | 'assistant'; content: string }[][] = [];

  for (let i = recent.length - 1; i >= 0; i--) {
    const turn = recent[i];
    const pair: { role: 'user' | 'assistant'; content: string }[] = [];
    const queryTokens = estimateTokens(turn.query);
    const responseTokens = turn.response ? estimateTokens(turn.response) : 0;
    const pairCost = queryTokens + responseTokens;

    if (pairCost > tokenBudget) break;
    tokenBudget -= pairCost;

    pair.push({ role: 'user', content: turn.query });
    if (turn.response) {
      pair.push({ role: 'assistant', content: turn.response });
    }
    pairs.unshift(pair);
  }

  for (const pair of pairs) {
    messages.push(...pair);
  }

  return messages;
}

/** Get all turns (for UI display) */
export function getAllTurns(): ConversationTurn[] {
  return [..._turns];
}

/** Clear conversation history */
export function clearConversation(): void {
  _turns = [];
  persist();
}
