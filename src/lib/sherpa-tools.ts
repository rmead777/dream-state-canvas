/**
 * Sherpa Tools — tool definitions + executors for the agent loop.
 *
 * Tools give Sherpa the ability to read workspace data, modify cards,
 * query datasets, and access memory. Each tool is defined in OpenAI
 * function-calling format and has a client-side executor.
 */
import { WorkspaceObject, WorkspaceState } from './workspace-types';
import { executeDataQuery } from './data-query';
import { getActiveDataset, getDataset } from './active-dataset';
import { getDocument } from './document-store';
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
      description: 'Run a filter/sort/limit query against a dataset. Defaults to the active dataset. Pass documentId to query a specific uploaded document.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'object', description: '{ column, operator, value }' },
          filters: { type: 'array', items: { type: 'object' }, description: 'Array of filter objects for multiple conditions' },
          columns: { type: 'array', items: { type: 'string' }, description: 'Which columns to return' },
          sort: { type: 'object', description: '{ column, direction: "asc"|"desc" }' },
          limit: { type: 'number', description: 'Max rows to return' },
          documentId: { type: 'string', description: 'Optional: query a specific uploaded document instead of the active dataset' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'joinDatasets',
      description: 'JOIN two uploaded documents on a shared key column. Returns merged rows. Use when the user wants to cross-reference data from two different files (e.g., AP aging vs bank transactions on vendor name).',
      parameters: {
        type: 'object',
        properties: {
          leftDocumentId: { type: 'string', description: 'Document ID of the left table (or omit for active dataset)' },
          rightDocumentId: { type: 'string', description: 'Document ID of the right table' },
          leftKey: { type: 'string', description: 'Column name in the left table to join on' },
          rightKey: { type: 'string', description: 'Column name in the right table to join on' },
          columns: { type: 'array', items: { type: 'string' }, description: 'Columns to include in results (from either table)' },
          limit: { type: 'number', description: 'Max rows to return (default 30)' },
        },
        required: ['rightDocumentId', 'leftKey', 'rightKey'],
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
          sections: { type: 'array', items: { type: 'object' }, description: 'Replace card content with these sections' },
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
          sections: { type: 'array', items: { type: 'object' } },
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

  // ALERT tools
  {
    type: 'function' as const,
    function: {
      name: 'setThreshold',
      description: 'Create a persistent alert threshold. When the condition fires against the active dataset, Sherpa will notify the user automatically (checked every 60 seconds). Use this when the user says "alert me when...", "notify me if...", "watch for...".',
      parameters: {
        type: 'object',
        properties: {
          column: { type: 'string', description: 'Dataset column to monitor' },
          operator: { type: 'string', description: 'gt|lt|gte|lte|eq|neq' },
          value: { type: 'number', description: 'Threshold value to compare against' },
          label: { type: 'string', description: 'Human-readable alert label, e.g. "High Balance Warning"' },
          severity: { type: 'string', description: 'info|warning|danger' },
          aggregation: { type: 'string', description: 'any (default)|count|sum — how to aggregate matching rows' },
        },
        required: ['column', 'operator', 'value', 'label'],
      },
    },
  },

  // NEXT MOVES tool
  {
    type: 'function' as const,
    function: {
      name: 'suggestNextMoves',
      description: 'Suggest 2-3 follow-up actions the user might want to take next, based on what you just found or created. Call this as your FINAL action after any createCard or updateCard calls.',
      parameters: {
        type: 'object',
        properties: {
          moves: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Short button label (3-6 words, specific to the data)' },
                query: { type: 'string', description: 'The full query to send when clicked' },
              },
              required: ['label', 'query'],
            },
            description: '2-3 specific, data-grounded follow-up actions',
          },
        },
        required: ['moves'],
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
  joinDatasets: 'Joining datasets...',
  setThreshold: 'Setting alert threshold...',
  suggestNextMoves: '',
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
          sections: obj.context?.sections || null,
        });
      }

      case 'queryDataset': {
        // Support optional documentId for multi-document queries
        const ds = args.documentId
          ? await getDataset(args.documentId)
          : getActiveDataset();
        const result = executeDataQuery({ ...args, _dataset: ds });
        return JSON.stringify({
          columns: result.columns,
          rows: result.rows.slice(0, 30),
          totalMatched: result.totalMatched,
          truncated: result.truncated || result.rows.length > 30,
          sourceLabel: ds.sourceLabel,
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

      case 'joinDatasets': {
        const [leftDs, rightDs] = await Promise.all([
          getDataset(args.leftDocumentId),
          getDataset(args.rightDocumentId),
        ]);

        const leftKeyIdx = leftDs.columns.findIndex(
          (c) => c.toLowerCase() === String(args.leftKey).toLowerCase()
        );
        const rightKeyIdx = rightDs.columns.findIndex(
          (c) => c.toLowerCase() === String(args.rightKey).toLowerCase()
        );

        if (leftKeyIdx === -1) return JSON.stringify({ error: `Left key "${args.leftKey}" not found in ${leftDs.sourceLabel}` });
        if (rightKeyIdx === -1) return JSON.stringify({ error: `Right key "${args.rightKey}" not found in ${rightDs.sourceLabel}` });

        // Build hash map from right dataset keyed on join column
        const rightMap = new Map<string, string[]>();
        for (const row of rightDs.rows) {
          const key = String(row[rightKeyIdx] ?? '').toLowerCase().trim();
          if (!rightMap.has(key)) rightMap.set(key, row);
        }

        // Join: for each left row, look up matching right row
        const joinedRows: (string | null)[][] = [];
        for (const leftRow of leftDs.rows) {
          const key = String(leftRow[leftKeyIdx] ?? '').toLowerCase().trim();
          const rightRow = rightMap.get(key);
          if (rightRow) {
            joinedRows.push([...leftRow, ...rightRow]);
          }
        }

        // Build merged column headers
        const mergedColumns = [
          ...leftDs.columns.map((c) => `${leftDs.sourceLabel}.${c}`),
          ...rightDs.columns.map((c) => `${rightDs.sourceLabel}.${c}`),
        ];

        // Column filter if requested
        let outColumns = mergedColumns;
        let outRows = joinedRows;
        if (args.columns?.length) {
          const requestedLower = (args.columns as string[]).map((c: string) => c.toLowerCase());
          const indices = mergedColumns
            .map((c, i) => (requestedLower.some((r) => c.toLowerCase().includes(r)) ? i : -1))
            .filter((i) => i !== -1);
          outColumns = indices.map((i) => mergedColumns[i]);
          outRows = joinedRows.map((row) => indices.map((i) => row[i] ?? null));
        }

        const limit = args.limit || 30;
        return JSON.stringify({
          columns: outColumns,
          rows: outRows.slice(0, limit),
          totalMatched: outRows.length,
          truncated: outRows.length > limit,
          leftSource: leftDs.sourceLabel,
          rightSource: rightDs.sourceLabel,
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
        // Extract keywords from content for trigger matching
        const keywords = args.content.toLowerCase()
          .split(/\s+/)
          .filter((w: string) => w.length > 3 && !['that', 'this', 'when', 'with', 'from', 'should', 'the', 'and'].includes(w))
          .slice(0, 5);
        const memory = await createMemory({
          type: args.type as any,
          trigger: {
            always: args.type === 'correction',
            onQueryContains: keywords.length > 0 ? keywords : undefined,
          },
          content: args.content,
          reasoning: args.reasoning,
          confidence: args.type === 'correction' ? 0.7 : 0.5,
          source: 'inferred',
          tags: keywords,
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

      case 'setThreshold': {
        const thresholdData = {
          column: args.column,
          operator: args.operator,
          value: Number(args.value),
          label: args.label,
          severity: args.severity ?? 'warning',
          aggregation: args.aggregation ?? 'any',
        };
        const memory = await createMemory({
          type: 'threshold',
          trigger: { always: false },
          content: JSON.stringify(thresholdData),
          reasoning: `User-defined alert: ${args.label}`,
          confidence: 0.9,
          source: 'explicit',
          tags: ['threshold', args.column?.toLowerCase() || ''],
        });
        return JSON.stringify({
          saved: !!memory,
          id: memory?.id,
          threshold: thresholdData,
          message: `Alert set: ${args.label}. I'll watch ${args.column} ${args.operator} ${args.value} every 60 seconds.`,
        });
      }

      case 'suggestNextMoves':
        return JSON.stringify({ action: 'nextMoves', moves: args.moves || [] });

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    console.error(`[sherpa-tools] Tool "${name}" failed:`, err);
    return JSON.stringify({ error: `Tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}` });
  }
}
