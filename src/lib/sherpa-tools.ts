/**
 * Sherpa Tools — tool definitions + executors for the agent loop.
 *
 * Tools give Sherpa the ability to read workspace data, modify cards,
 * query datasets, and access memory. Each tool is defined in OpenAI
 * function-calling format and has a client-side executor.
 */
import { WorkspaceObject, WorkspaceState } from './workspace-types';
import { executeDataQuery } from './data-query';
import { getActiveDataset } from './active-dataset';
import { getDocument, listDocuments } from './document-store';
import { createMemory } from './memory-store';
import { retrieveRelevantMemories, formatMemoriesForPrompt, determineWorkspaceState } from './memory-retriever';
import { supabase } from '@/integrations/supabase/client';

// ─── Tool Definitions (OpenAI function-calling format) ──────────────────────

export const SHERPA_TOOLS = [
  // READ tools
  {
    type: 'function' as const,
    function: {
      name: 'getCardData',
      description: 'Get the full data of a specific workspace card — its type, title, rows, columns, sections, filters, and current state. Use this to understand what a card shows before modifying it.',
      parameters: {
        type: 'object',
        properties: {
          objectId: { type: 'string', description: 'The card ID (e.g., "wo-12345")' },
        },
        required: ['objectId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'queryDataset',
      description: 'Run a filter/sort/limit query against the active dataset. Returns matching rows with selected columns. Use this to find specific data.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'object', description: '{ column, operator, value }' },
          filters: { type: 'array', description: 'Array of filter objects for multiple conditions' },
          columns: { type: 'array', items: { type: 'string' }, description: 'Which columns to return' },
          sort: { type: 'object', description: '{ column, direction: "asc"|"desc" }' },
          limit: { type: 'number', description: 'Max rows to return' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getWorkspaceState',
      description: 'Get a summary of all cards on the canvas — IDs, types, titles, statuses, which is focused, row counts.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'searchData',
      description: 'Full-text search across all dataset rows. Returns matching rows.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search for' },
          column: { type: 'string', description: 'Optional: limit search to this column' },
          limit: { type: 'number', description: 'Max rows (default 20)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getDocumentContent',
      description: 'Get the extracted text and structured data from an uploaded document.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string' },
        },
        required: ['documentId'],
      },
    },
  },

  // WRITE tools
  {
    type: 'function' as const,
    function: {
      name: 'updateCard',
      description: 'Update an existing card — change its data query (filter/sort/limit/columns), replace sections, or change title.',
      parameters: {
        type: 'object',
        properties: {
          objectId: { type: 'string' },
          dataQuery: { type: 'object', description: 'New data query to apply' },
          sections: { type: 'array', description: 'Replace card content with these sections' },
          title: { type: 'string', description: 'New title' },
        },
        required: ['objectId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'createCard',
      description: 'Create a new card on the workspace canvas.',
      parameters: {
        type: 'object',
        properties: {
          objectType: { type: 'string', description: 'Card type (metric, alert, analysis, action-queue, etc.)' },
          title: { type: 'string' },
          dataQuery: { type: 'object' },
          sections: { type: 'array' },
        },
        required: ['objectType', 'title'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'dissolveCard',
      description: 'Remove a card from the workspace.',
      parameters: {
        type: 'object',
        properties: { objectId: { type: 'string' } },
        required: ['objectId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'focusCard',
      description: 'Bring a card to the user\'s attention.',
      parameters: {
        type: 'object',
        properties: { objectId: { type: 'string' } },
        required: ['objectId'],
      },
    },
  },

  // MEMORY tools
  {
    type: 'function' as const,
    function: {
      name: 'rememberFact',
      description: 'Store a fact, preference, correction, or pattern in long-term memory.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'correction | preference | entity | pattern | anti-pattern' },
          content: { type: 'string' },
          reasoning: { type: 'string' },
        },
        required: ['type', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'recallMemories',
      description: 'Search long-term memory for relevant facts, preferences, or corrections.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
    },
  },
];

// ─── Status Messages ────────────────────────────────────────────────────────

const TOOL_STATUS: Record<string, string> = {
  getCardData: 'Reading card data...',
  queryDataset: 'Querying dataset...',
  getWorkspaceState: 'Checking workspace...',
  searchData: 'Searching data...',
  getDocumentContent: 'Reading document...',
  updateCard: 'Updating card...',
  createCard: 'Creating card...',
  dissolveCard: 'Removing card...',
  focusCard: 'Focusing card...',
  rememberFact: 'Saving to memory...',
  recallMemories: 'Checking memory...',
};

export function getToolStatus(toolName: string): string {
  return TOOL_STATUS[toolName] || 'Processing...';
}

// ─── Tool Executors ─────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, any>,
  state: WorkspaceState,
): Promise<string> {
  try {
    switch (name) {
      case 'getCardData': {
        const obj = state.objects[args.objectId];
        if (!obj) return JSON.stringify({ error: `Card "${args.objectId}" not found` });
        return JSON.stringify({
          id: obj.id,
          type: obj.type,
          title: obj.title,
          status: obj.status,
          pinned: obj.pinned,
          rowCount: Array.isArray(obj.context?.rows) ? obj.context.rows.length : null,
          columnCount: Array.isArray(obj.context?.columns) ? obj.context.columns.length : null,
          columns: obj.context?.columns || null,
          rows: Array.isArray(obj.context?.rows) ? obj.context.rows.slice(0, 10) : null,
          dataQuery: obj.context?.dataQuery || null,
          sections: obj.context?.sections ? `${obj.context.sections.length} sections` : null,
        });
      }

      case 'queryDataset': {
        const result = executeDataQuery(args);
        return JSON.stringify({
          columns: result.columns,
          rows: result.rows.slice(0, 30), // cap to avoid massive payloads
          totalMatched: result.totalMatched,
          truncated: result.truncated || result.rows.length > 30,
        });
      }

      case 'getWorkspaceState': {
        const active = Object.values(state.objects)
          .filter(o => o.status !== 'dissolved')
          .sort((a, b) => b.lastInteractedAt - a.lastInteractedAt);
        return JSON.stringify(active.map(o => ({
          id: o.id,
          type: o.type,
          title: o.title,
          status: o.status,
          isFocused: o.id === state.activeContext?.focusedObjectId,
          rowCount: Array.isArray(o.context?.rows) ? o.context.rows.length : null,
          pinned: o.pinned,
        })));
      }

      case 'searchData': {
        const { columns, rows } = getActiveDataset();
        const query = String(args.query).toLowerCase();
        const colIdx = args.column ? columns.indexOf(args.column) : -1;
        const limit = args.limit || 20;

        const matches = rows.filter(row => {
          if (colIdx >= 0) return String(row[colIdx] ?? '').toLowerCase().includes(query);
          return row.some(cell => String(cell ?? '').toLowerCase().includes(query));
        }).slice(0, limit);

        return JSON.stringify({
          columns,
          rows: matches,
          totalMatched: matches.length,
          query: args.query,
        });
      }

      case 'getDocumentContent': {
        const doc = await getDocument(args.documentId);
        if (!doc) return JSON.stringify({ error: `Document "${args.documentId}" not found` });
        return JSON.stringify({
          id: doc.id,
          filename: doc.filename,
          fileType: doc.file_type,
          extractedText: doc.extracted_text?.slice(0, 3000) || '',
          metadata: doc.metadata,
        });
      }

      // Write tools return instructions — the agent loop applies them
      case 'updateCard':
        return JSON.stringify({ action: 'update', objectId: args.objectId, dataQuery: args.dataQuery, sections: args.sections, title: args.title });

      case 'createCard':
        return JSON.stringify({ action: 'create', objectType: args.objectType, title: args.title, dataQuery: args.dataQuery, sections: args.sections });

      case 'dissolveCard':
        return JSON.stringify({ action: 'dissolve', objectId: args.objectId });

      case 'focusCard':
        return JSON.stringify({ action: 'focus', objectId: args.objectId });

      case 'rememberFact': {
        const memory = await createMemory({
          type: args.type as any,
          trigger: { always: args.type === 'correction' },
          content: args.content,
          reasoning: args.reasoning,
          confidence: args.type === 'correction' ? 0.7 : 0.5,
          source: 'inferred',
        });
        return JSON.stringify({ saved: !!memory, id: memory?.id });
      }

      case 'recallMemories': {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return JSON.stringify({ memories: [] });
        const memories = await retrieveRelevantMemories(user.id, {
          query: args.query,
          objectTypes: Object.values(state.objects).filter(o => o.status !== 'dissolved').map(o => o.type),
          workspaceState: determineWorkspaceState(state),
        });
        return JSON.stringify({ memories: memories.map(m => ({ type: m.type, content: m.content, confidence: m.confidence })) });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    console.error(`[sherpa-tools] Tool "${name}" failed:`, err);
    return JSON.stringify({ error: `Tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}` });
  }
}
