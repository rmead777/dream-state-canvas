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
import { createMemory, deleteMemory, getMemories } from './memory-store';
import { retrieveRelevantMemories, formatMemoriesForPrompt, determineWorkspaceState } from './memory-retriever';
import { supabase } from '@/integrations/supabase/client';
import { createTrigger as saveTrigger } from './automation-triggers';
import { fetchQBOData, clearQBOCache, type QBODataType } from './quickbooks-store';

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
  {
    type: 'function' as const,
    function: {
      name: 'openInImmersive',
      description: 'Open an existing workspace card in full-screen immersive view. Use this when the user asks to "open", "view", "read", or "expand" a card that is already on the canvas.',
      parameters: {
        type: 'object',
        properties: { objectId: { type: 'string', description: 'ID of the workspace card to open in immersive view' } },
        required: ['objectId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'openSourceDocument',
      description: 'Open an uploaded source file directly in its native immersive viewer — full spreadsheet table for XLSX/CSV, native PDF canvas for PDFs. Use this when the user says "open the source file", "open the tracker", "view the spreadsheet", "open the PDF", "read the document", or references a filename from the UPLOADED DOCUMENTS list. Automatically creates the source card if it is not already on the canvas.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'The document ID from the UPLOADED DOCUMENTS list' },
        },
        required: ['documentId'],
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

  // MEMORY CLEANUP tool
  {
    type: 'function' as const,
    function: {
      name: 'consolidateMemories',
      description: 'Clean up, consolidate, and deduplicate Sherpa memories. Use when the user says "clean up memories", "consolidate memories", "too many memories", "memory cleanup", etc. Reads all stored memories, identifies redundant/duplicate/obsolete entries, and proposes: deletions (with reason) and optional merged replacements. The user confirms before any changes are applied.',
      parameters: {
        type: 'object',
        properties: {
          deleteIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'IDs of memories to delete (redundant, obsolete, or being merged into a consolidated entry)',
          },
          deleteReasons: {
            type: 'array',
            items: { type: 'string' },
            description: 'Reason for each deletion (same order as deleteIds)',
          },
          newMemories: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', description: 'correction | preference | pattern | anti-pattern' },
                content: { type: 'string', description: 'The consolidated memory content' },
                reasoning: { type: 'string', description: 'What this replaces and why' },
              },
              required: ['type', 'content'],
            },
            description: 'New consolidated memories to create (replacing the deleted redundant ones)',
          },
          summary: { type: 'string', description: 'Human-readable summary of all changes proposed' },
        },
        required: ['deleteIds', 'summary'],
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

  // SHOW AUTOMATIONS tool
  {
    type: 'function' as const,
    function: {
      name: 'showAutomations',
      description: 'Show the user\'s active automation triggers in a management panel. Use when the user says "show my automations", "list my triggers", "what automations do I have", "manage triggers", etc.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },

  // AUTOMATION TRIGGER tool
  {
    type: 'function' as const,
    function: {
      name: 'createTrigger',
      description: 'Create a persistent workflow automation trigger. The trigger monitors a dataset condition and fires automatically when met (checked every 30 seconds). Use when the user says "automatically", "whenever", "trigger when", "watch and do", etc.',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Human-readable trigger name, e.g. "Flag overdue invoices"' },
          condition: {
            type: 'object',
            description: 'Condition to evaluate against the dataset',
            properties: {
              column: { type: 'string', description: 'Dataset column to monitor' },
              operator: { type: 'string', description: 'gt|lt|gte|lte|eq|neq' },
              value: { type: 'number', description: 'Threshold value' },
              aggregation: { type: 'string', description: 'any (default)|count|sum' },
            },
            required: ['column', 'operator', 'value'],
          },
          actionType: { type: 'string', description: 'notify (default) | create_card' },
          actionParams: { type: 'object', description: 'For create_card: { objectType, title, query }' },
        },
        required: ['label', 'condition'],
      },
    },
  },

  // EMAIL DRAFT tool
  {
    type: 'function' as const,
    function: {
      name: 'draftEmail',
      description: 'Compose a professional email draft based on workspace data. Creates an email-draft card the user can copy or open in their email client. Use when the user says "draft an email", "write an email to", "send a follow-up to", etc.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email or name (e.g. "vendor@company.com" or "Acme Corp contact")' },
          subject: { type: 'string', description: 'Email subject line' },
          body: { type: 'string', description: 'Full email body text. Use \\n for line breaks.' },
          contextCardId: { type: 'string', description: 'Optional: ID of the card that triggered this draft, for provenance' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },

  // CALENDAR tool
  {
    type: 'function' as const,
    function: {
      name: 'createCalendarEvent',
      description: 'Create a calendar event and offer a .ics download. Use when the user says "add to calendar", "schedule a meeting", "set a reminder", "deadline on [date]", etc.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Event title' },
          date: { type: 'string', description: 'ISO 8601 date (YYYY-MM-DD) or datetime (YYYY-MM-DDTHH:mm)' },
          durationMinutes: { type: 'number', description: 'Duration in minutes (default 60 for meetings, 0 for all-day deadlines)' },
          description: { type: 'string', description: 'Optional event notes / description' },
          allDay: { type: 'boolean', description: 'True for deadline reminders with no specific time' },
        },
        required: ['title', 'date'],
      },
    },
  },

  // EXPORT tool
  {
    type: 'function' as const,
    function: {
      name: 'exportWorkspace',
      description: 'Generate a PDF report of the current workspace or specific cards. Use when the user says "export", "generate a report", "create a PDF", "download as PDF", etc.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Report title' },
          cardIds: { type: 'array', items: { type: 'string' }, description: 'Optional: specific card IDs to include. If omitted, includes all visible cards.' },
          includeData: { type: 'boolean', description: 'Include raw data tables in the report (default: false — summary only)' },
        },
        required: ['title'],
      },
    },
  },

  // SIMULATION tool
  {
    type: 'function' as const,
    function: {
      name: 'runSimulation',
      description: 'Run a what-if scenario simulation on dataset metrics. Creates a simulation card showing original vs. adjusted projections. Use when the user says "what if", "simulate", "model the impact", "project", "forecast", etc.',
      parameters: {
        type: 'object',
        properties: {
          metric: { type: 'string', description: 'The metric or column to simulate (e.g. "revenue", "balance", "invoice amount")' },
          scenarioA: {
            type: 'object',
            description: 'Baseline scenario',
            properties: {
              label: { type: 'string' },
              assumption: { type: 'string', description: 'Human-readable assumption (e.g. "Current trajectory")' },
              adjustmentPct: { type: 'number', description: 'Percentage change from baseline (0 = no change)' },
            },
          },
          scenarioB: {
            type: 'object',
            description: 'Alternative scenario',
            properties: {
              label: { type: 'string' },
              assumption: { type: 'string', description: 'Human-readable assumption (e.g. "+15% growth")' },
              adjustmentPct: { type: 'number', description: 'Percentage change from baseline' },
            },
          },
          periods: { type: 'number', description: 'Number of periods to project (default 6)' },
          periodLabel: { type: 'string', description: 'Period unit (months, quarters, weeks — default: months)' },
        },
        required: ['metric', 'scenarioA', 'scenarioB'],
      },
    },
  },

  // QUICKBOOKS tool
  {
    type: 'function' as const,
    function: {
      name: 'queryQuickBooks',
      description: 'Fetch live financial data from the company\'s QuickBooks Online account. Returns AP (accounts payable/bills), AR (accounts receivable/invoices), bank balances, P&L, bill payments, vendor list, customer list, or a full financial summary. Use when the user asks about cash flow, accounts payable, accounts receivable, invoices, bills, payments, vendors, customers, bank balances, working capital, or any financial analysis that would benefit from live accounting data.',
      parameters: {
        type: 'object',
        properties: {
          dataType: {
            type: 'string',
            enum: ['ap', 'ar', 'bank', 'pnl', 'vendors', 'customers', 'bill_payments', 'summary'],
            description: 'What to fetch. "summary" returns cash + AR + AP + working capital in one call. "ap" = unpaid bills by vendor with aging. "ar" = open + recent invoices by customer with aging. "bank" = bank account balances. "pnl" = profit & loss report. "bill_payments" = bill payment history with vendor, method, and which bills were paid. "vendors" = vendor list. "customers" = customer list.',
          },
          options: {
            type: 'object',
            description: 'Optional parameters. For pnl: { startDate, endDate, summarizeBy }. Dates are YYYY-MM-DD.',
            properties: {
              startDate: { type: 'string' },
              endDate: { type: 'string' },
              summarizeBy: { type: 'string', description: 'Month, Quarter, or Year' },
            },
          },
        },
        required: ['dataType'],
      },
    },
  },
  // DATASET EDITING tool
  {
    type: 'function' as const,
    function: {
      name: 'editDataset',
      description: 'Edit the source spreadsheet data — update cells, add/delete rows, add/rename columns. Use when the user asks to update the tracker, mark something as paid, change a status, add new entries, reconcile data with QuickBooks, or any request that requires modifying the underlying spreadsheet. Creates a preview card showing proposed changes for user confirmation before applying. NEVER use this to modify QuickBooks data — QB is read-only. This only modifies uploaded spreadsheets.',
      parameters: {
        type: 'object',
        properties: {
          operations: {
            type: 'array',
            description: 'Array of edit operations to apply in order',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['updateCell', 'addRow', 'deleteRow', 'addColumn', 'renameColumn'],
                  description: 'Operation type',
                },
                row: { type: 'number', description: 'Row index (0-based). Required for updateCell and deleteRow.' },
                column: { type: 'string', description: 'Column name. Required for updateCell, addColumn, renameColumn.' },
                value: { type: 'string', description: 'New cell value for updateCell, or default value for addColumn.' },
                values: { type: 'object', description: 'For addRow: object mapping column names to values, e.g. {"Vendor": "Acme", "Amount": "5000"}' },
                newName: { type: 'string', description: 'For renameColumn: the new column name.' },
                afterColumn: { type: 'string', description: 'For addColumn: insert after this column (omit to append at end).' },
              },
              required: ['type'],
            },
          },
          reason: { type: 'string', description: 'Brief explanation of why these changes are being made (shown to user in preview)' },
          documentId: { type: 'string', description: 'Optional: edit a specific document by ID. Defaults to the active dataset.' },
        },
        required: ['operations', 'reason'],
      },
    },
  },

  {
    type: 'function' as const,
    function: {
      name: 'refreshQuickBooks',
      description: 'Clear the cached QuickBooks data and fetch fresh data from the live QB API. Use when the user says "refresh quickbooks", "pull fresh QB data", "update the financials", "get latest from quickbooks", etc. After clearing, the next queryQuickBooks call will hit the live API.',
      parameters: {
        type: 'object',
        properties: {
          dataType: {
            type: 'string',
            enum: ['ap', 'ar', 'bank', 'pnl', 'vendors', 'customers', 'bill_payments', 'summary', 'all'],
            description: 'Which data to refresh. Use "all" to clear everything and re-fetch a fresh summary. Default: "all".',
          },
        },
      },
    },
  },

  // COMPUTE STATS tool
  {
    type: 'function' as const,
    function: {
      name: 'computeStats',
      description: 'Compute statistical analysis on dataset columns. Returns aggregates, distributions, percentiles, correlations, outliers, group-by summaries, and pivot tables. Use this BEFORE creating visualizations to understand the data shape, and when the user asks analytical questions like "what\'s the average", "show distribution", "find outliers", "compare groups", "correlate X with Y", "top N by", "year-over-year", etc.',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['summary', 'distribution', 'percentiles', 'correlation', 'groupBy', 'topN', 'outliers', 'pivot', 'timeSeries', 'frequency'],
            description: 'Type of analysis. summary=descriptive stats for columns. distribution=histogram bins. percentiles=p10/25/50/75/90. correlation=pairwise r-values. groupBy=aggregate by category. topN=ranked items. outliers=IQR-based detection. pivot=cross-tab. timeSeries=period-over-period changes. frequency=value counts.',
          },
          columns: { type: 'array', items: { type: 'string' }, description: 'Column names to analyze' },
          groupByColumn: { type: 'string', description: 'For groupBy/pivot: column to group rows by' },
          aggregation: { type: 'string', description: 'sum|avg|count|min|max|median (default: sum)' },
          n: { type: 'number', description: 'For topN: how many results (default 10). For distribution: number of bins (default 10).' },
          sortDirection: { type: 'string', description: 'asc|desc (default: desc)' },
          documentId: { type: 'string', description: 'Optional: analyze a specific document instead of active dataset' },
          dateColumn: { type: 'string', description: 'For timeSeries: the column containing dates' },
          periodGrouping: { type: 'string', description: 'For timeSeries: day|week|month|quarter|year' },
        },
        required: ['operation'],
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
  openInImmersive: 'Opening in immersive view...',
  openSourceDocument: 'Opening source file...',
  rememberFact: 'Saving to memory...',
  recallMemories: 'Checking memory...',
  joinDatasets: 'Joining datasets...',
  setThreshold: 'Setting alert threshold...',
  showAutomations: 'Loading automations...',
  createTrigger: 'Creating automation trigger...',
  draftEmail: 'Composing email...',
  createCalendarEvent: 'Creating calendar event...',
  exportWorkspace: 'Generating PDF report...',
  runSimulation: 'Running simulation...',
  consolidateMemories: 'Cleaning up memories...',
  editDataset: 'Preparing dataset changes...',
  queryQuickBooks: 'Fetching QuickBooks data...',
  refreshQuickBooks: 'Refreshing QuickBooks data...',
  computeStats: 'Analyzing data...',
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

        // Build one-to-many hash map from right dataset keyed on join column
        // (many-to-many: e.g., multiple bank transactions per vendor)
        const rightMap = new Map<string, string[][]>();
        for (const row of rightDs.rows) {
          const key = String(row[rightKeyIdx] ?? '').toLowerCase().trim();
          const existing = rightMap.get(key) || [];
          existing.push(row);
          rightMap.set(key, existing);
        }

        // INNER JOIN: Cartesian product of left × all matching right rows
        const joinedRows: (string | null)[][] = [];
        let unmatchedLeft = 0;
        for (const leftRow of leftDs.rows) {
          const key = String(leftRow[leftKeyIdx] ?? '').toLowerCase().trim();
          const rightRows = rightMap.get(key);
          if (rightRows && rightRows.length > 0) {
            for (const rightRow of rightRows) {
              joinedRows.push([...leftRow, ...rightRow]);
            }
          } else {
            unmatchedLeft++;
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
          // F-010: unmatched count lets AI report "matched X of Y vendors"
          unmatchedLeft,
          note: unmatchedLeft > 0 ? `${unmatchedLeft} left-side rows had no match in ${rightDs.sourceLabel}` : undefined,
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

      case 'openInImmersive':
        return JSON.stringify({ action: 'immersive', objectId: args.objectId });

      case 'openSourceDocument':
        return JSON.stringify({ action: 'open-source-document', documentId: args.documentId });

      case 'rememberFact': {
        const keywords = args.content.toLowerCase()
          .split(/\s+/)
          .filter((w: string) => w.length > 3 && !['that', 'this', 'when', 'with', 'from', 'should', 'the', 'and'].includes(w))
          .slice(0, 5);
        // All memory types are always-on — the AI only saves things that matter,
        // and keyword-only triggering was causing most preferences to never inject.
        const memory = await createMemory({
          type: args.type as any,
          trigger: { always: true },
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
        // If query asks for "all" memories (e.g. for cleanup), return the full list
        const queryLower = String(args.query).toLowerCase();
        const wantsAll = queryLower.includes('all') || queryLower.includes('cleanup') || queryLower.includes('consolidat') || queryLower.includes('every');
        let memories;
        if (wantsAll) {
          memories = await getMemories(user.id);
        } else {
          memories = await retrieveRelevantMemories(user.id, {
            query: args.query,
            objectTypes: Object.values(state.objects).filter(o => o.status !== 'dissolved').map(o => o.type),
            workspaceState: determineWorkspaceState(state),
          });
        }
        return JSON.stringify({ memories: memories.map(m => ({ id: m.id, type: m.type, content: m.content, confidence: m.confidence, hitCount: m.hitCount })) });
      }

      case 'consolidateMemories': {
        const deleteIds = (args.deleteIds || []) as string[];
        const deleteReasons = (args.deleteReasons || []) as string[];
        const newMems = (args.newMemories || []) as Array<{ type: string; content: string; reasoning?: string }>;
        const summary = args.summary || '';

        // Return a preview card — changes apply when user clicks "Apply"
        return JSON.stringify({
          action: 'create',
          objectType: 'memory-cleanup-preview',
          title: 'Memory Cleanup',
          data: {
            isMemoryCleanup: true,
            deleteIds,
            deleteReasons,
            newMemories: newMems,
            summary,
            operationCount: deleteIds.length + newMems.length,
          },
        });
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

      case 'showAutomations':
        return JSON.stringify({
          action: 'create',
          objectType: 'analysis',
          title: '⚡ Automation Triggers',
          data: { isAutomationPanel: true },
          sections: [],
        });

      case 'createTrigger': {
        const trigger = await saveTrigger({
          label: args.label,
          condition: {
            column: args.condition.column,
            operator: args.condition.operator,
            value: Number(args.condition.value),
            aggregation: args.condition.aggregation ?? 'any',
          },
          action: {
            type: (args.actionType ?? 'notify') as 'notify' | 'create_card',
            params: args.actionParams ?? {},
          },
        });
        if (!trigger) {
          return JSON.stringify({ error: 'Failed to create trigger. Automation triggers table may not be deployed yet.' });
        }
        return JSON.stringify({
          saved: true,
          id: trigger.id,
          label: trigger.label,
          message: `Automation trigger "${trigger.label}" is active. I'll check it every 30 seconds.`,
        });
      }

      case 'draftEmail':
        return JSON.stringify({
          action: 'create',
          objectType: 'email-draft',
          title: args.subject || 'Email Draft',
          data: {
            to: args.to,
            subject: args.subject,
            body: args.body,
            contextCardId: args.contextCardId,
          },
        });

      case 'createCalendarEvent': {
        const { title, date, durationMinutes = 60, description = '', allDay = false } = args;
        // Build .ics content in-browser — no server round-trip needed
        const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@dreamstate`;
        const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
        let dtStart: string;
        let dtEnd: string;
        if (allDay || !date.includes('T')) {
          const d = date.slice(0, 10).replace(/-/g, '');
          // RFC 5545 §3.8.2.2: DTEND for VALUE=DATE is exclusive — next day for single-day events
          const nextDay = new Date(date.slice(0, 10));
          nextDay.setDate(nextDay.getDate() + 1);
          const dEnd = nextDay.toISOString().slice(0, 10).replace(/-/g, '');
          dtStart = `DTSTART;VALUE=DATE:${d}`;
          dtEnd = `DTEND;VALUE=DATE:${dEnd}`;
        } else {
          const start = new Date(date);
          const end = new Date(start.getTime() + (durationMinutes || 60) * 60000);
          dtStart = `DTSTART:${start.toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z`;
          dtEnd = `DTEND:${end.toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z`;
        }
        const icsContent = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//Dream State Canvas//EN',
          'BEGIN:VEVENT',
          `UID:${uid}`,
          `DTSTAMP:${now}`,
          dtStart,
          dtEnd,
          `SUMMARY:${title}`,
          description ? `DESCRIPTION:${description.replace(/\n/g, '\\n')}` : '',
          'END:VEVENT',
          'END:VCALENDAR',
        ].filter(Boolean).join('\r\n');
        return JSON.stringify({
          action: 'create',
          objectType: 'analysis',
          title: `📅 ${title}`,
          data: {
            calendarEvent: { title, date, durationMinutes, description, allDay },
            icsContent,
            icsFilename: `${title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.ics`,
          },
          sections: [
            {
              type: 'narrative',
              text: `**${title}**\n\nDate: ${date}${!allDay && durationMinutes ? `\nDuration: ${durationMinutes} min` : ''}\n${description ? `\nNotes: ${description}` : ''}`,
            },
            {
              type: 'callout',
              severity: 'info',
              text: `Calendar event ready to download. Click the button below to add to your calendar.`,
            },
          ],
        });
      }

      case 'exportWorkspace': {
        // Collect visible card data from workspace state
        const visibleCards = Object.values(state.objects).filter(o => o.status !== 'dissolved');
        const cards = (args.cardIds?.length
          ? visibleCards.filter(o => args.cardIds.includes(o.id))
          : visibleCards
        ).map((o: WorkspaceObject) => ({
          id: o.id,
          type: o.type,
          title: o.title,
          sections: o.context?.sections || [],
          rows: Array.isArray(o.context?.rows) ? o.context.rows.slice(0, 20) : [],
          columns: o.context?.columns || [],
        }));

        try {
          const { data, error } = await supabase.functions.invoke('generate-report', {
            body: { title: args.title, cards, includeData: args.includeData ?? false },
          });
          if (error || !data?.url) {
            return JSON.stringify({ error: `PDF generation failed: ${error?.message || 'generate-report function may not be deployed yet'}` });
          }
          return JSON.stringify({
            action: 'create',
            objectType: 'analysis',
            title: `📊 ${args.title}`,
            data: { reportUrl: data.url, reportTitle: args.title },
            sections: [
              { type: 'summary', text: `Report "${args.title}" is ready` },
              { type: 'callout', severity: 'success', text: `PDF generated with ${cards.length} cards. Click "Download PDF Report" below.` },
            ],
          });
        } catch (err) {
          return JSON.stringify({ error: `Export failed: ${err instanceof Error ? err.message : 'Unknown error'}` });
        }
      }

      case 'runSimulation': {
        const { metric, scenarioA, scenarioB, periods = 6, periodLabel = 'months' } = args;
        const { columns, rows } = getActiveDataset();
        const colIdx = columns.findIndex((c: string) => c.toLowerCase().includes(metric.toLowerCase()));
        const baseValues: number[] = colIdx >= 0
          ? rows.map((r: any[]) => parseFloat(String(r[colIdx] ?? '0').replace(/[^0-9.-]/g, '')) || 0).filter((v: number) => !isNaN(v))
          : [100];
        const baseline = baseValues.length > 0 ? baseValues.reduce((a: number, b: number) => a + b, 0) / baseValues.length : 100;
        const aAdj = (scenarioA?.adjustmentPct ?? 0) / 100;
        const bAdj = (scenarioB?.adjustmentPct ?? 0) / 100;
        const simRows = Array.from({ length: periods }, (_, i) => ({
          period: i + 1,
          label: `${periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1)} ${i + 1}`,
          scenarioA: Math.round(baseline * Math.pow(1 + aAdj, i + 1) * 100) / 100,
          scenarioB: Math.round(baseline * Math.pow(1 + bAdj, i + 1) * 100) / 100,
        }));
        return JSON.stringify({
          action: 'create',
          objectType: 'simulation',
          title: `What-If: ${metric}`,
          data: {
            metric,
            baseline,
            periodLabel,
            scenarioA: { label: scenarioA?.label || 'Scenario A', assumption: scenarioA?.assumption || '', adjustmentPct: scenarioA?.adjustmentPct || 0 },
            scenarioB: { label: scenarioB?.label || 'Scenario B', assumption: scenarioB?.assumption || '', adjustmentPct: scenarioB?.adjustmentPct || 0 },
            simRows,
          },
        });
      }

      case 'queryQuickBooks': {
        const resp = await fetchQBOData(args.dataType as QBODataType, args.options);
        if (!resp.success) {
          return JSON.stringify({ error: resp.error || 'QuickBooks fetch failed' });
        }
        return JSON.stringify({
          company: resp.company,
          type: resp.type,
          ...resp.data,
        });
      }

      case 'editDataset': {
        // Get the target dataset
        const targetDs = args.documentId
          ? await getDataset(args.documentId)
          : getActiveDataset();

        const cols = [...targetDs.columns];
        const rows = targetDs.rows.map(r => [...r]);
        const ops = args.operations as Array<Record<string, any>>;
        const changes: Array<{ type: string; description: string; before?: string; after?: string }> = [];
        const errors: string[] = [];

        for (const op of ops) {
          switch (op.type) {
            case 'updateCell': {
              const colIdx = cols.findIndex(c => c.toLowerCase() === String(op.column).toLowerCase());
              if (colIdx === -1) { errors.push(`Column "${op.column}" not found`); break; }
              if (op.row < 0 || op.row >= rows.length) { errors.push(`Row ${op.row} out of range (0-${rows.length - 1})`); break; }
              const before = rows[op.row][colIdx];
              rows[op.row][colIdx] = String(op.value ?? '');
              changes.push({ type: 'update', description: `Row ${op.row}, "${cols[colIdx]}": "${before}" → "${op.value}"`, before, after: String(op.value ?? '') });
              break;
            }
            case 'addRow': {
              const newRow = cols.map(c => {
                const val = op.values?.[c] ?? op.values?.[c.toLowerCase()] ?? '';
                return String(val);
              });
              rows.push(newRow);
              const nonEmpty = Object.entries(op.values || {}).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ');
              changes.push({ type: 'add-row', description: `Add row ${rows.length - 1}: ${nonEmpty || '(empty row)'}` });
              break;
            }
            case 'deleteRow': {
              if (op.row < 0 || op.row >= rows.length) { errors.push(`Row ${op.row} out of range`); break; }
              const deleted = rows[op.row];
              const preview = cols.slice(0, 3).map((c, i) => `${c}=${deleted[i] || ''}`).join(', ');
              rows.splice(op.row, 1);
              changes.push({ type: 'delete-row', description: `Delete row ${op.row}: ${preview}` });
              break;
            }
            case 'addColumn': {
              if (cols.some(c => c.toLowerCase() === String(op.column).toLowerCase())) {
                errors.push(`Column "${op.column}" already exists`);
                break;
              }
              const insertIdx = op.afterColumn
                ? cols.findIndex(c => c.toLowerCase() === String(op.afterColumn).toLowerCase()) + 1
                : cols.length;
              const defaultVal = String(op.value ?? '');
              cols.splice(insertIdx, 0, op.column);
              for (const row of rows) {
                row.splice(insertIdx, 0, defaultVal);
              }
              changes.push({ type: 'add-column', description: `Add column "${op.column}"${op.afterColumn ? ` after "${op.afterColumn}"` : ' at end'}${defaultVal ? ` (default: "${defaultVal}")` : ''}` });
              break;
            }
            case 'renameColumn': {
              const renameIdx = cols.findIndex(c => c.toLowerCase() === String(op.column).toLowerCase());
              if (renameIdx === -1) { errors.push(`Column "${op.column}" not found`); break; }
              const oldName = cols[renameIdx];
              cols[renameIdx] = op.newName;
              changes.push({ type: 'rename-column', description: `Rename column "${oldName}" → "${op.newName}"` });
              break;
            }
            default:
              errors.push(`Unknown operation type: ${op.type}`);
          }
        }

        if (errors.length > 0 && changes.length === 0) {
          return JSON.stringify({ error: `All operations failed: ${errors.join('; ')}` });
        }

        // Return a preview card — the actual edit is applied when user clicks "Apply"
        return JSON.stringify({
          action: 'create',
          objectType: 'dataset-edit-preview',
          title: `Proposed Changes: ${targetDs.sourceLabel}`,
          data: {
            isDatasetEdit: true,
            reason: args.reason || 'AI-proposed dataset changes',
            changes,
            errors,
            // Store the full new state so Apply can use it directly
            newColumns: cols,
            newRows: rows,
            sourceDocId: args.documentId || targetDs.sourceDocId,
            sourceLabel: targetDs.sourceLabel,
            originalColumns: targetDs.columns,
            originalRows: targetDs.rows,
            operationCount: changes.length,
          },
        });
      }

      case 'refreshQuickBooks': {
        clearQBOCache();
        const refreshType = (args.dataType && args.dataType !== 'all')
          ? args.dataType as QBODataType
          : 'summary';
        const resp = await fetchQBOData(refreshType);
        if (!resp.success) {
          return JSON.stringify({ refreshed: false, error: resp.error || 'QuickBooks fetch failed' });
        }
        return JSON.stringify({
          refreshed: true,
          company: resp.company,
          type: resp.type,
          message: `Fresh ${refreshType} data pulled from QuickBooks.`,
          ...resp.data,
        });
      }

      case 'computeStats': {
        const ds = args.documentId
          ? await getDataset(args.documentId)
          : getActiveDataset();
        const { columns, rows } = ds;
        const targetCols = (args.columns as string[]) || columns;

        // Helper: parse numeric values from cells
        const parseNum = (val: any): number | null => {
          if (val == null) return null;
          const s = String(val).replace(/[$,%,]/g, '').trim();
          const n = parseFloat(s);
          return isNaN(n) ? null : n;
        };

        // Helper: get column values as numbers
        const getNumericValues = (colName: string): number[] => {
          const idx = columns.findIndex((c: string) => c.toLowerCase() === colName.toLowerCase());
          if (idx === -1) return [];
          return rows.map((r: any[]) => parseNum(r[idx])).filter((v): v is number => v !== null);
        };

        // Helper: get column values as strings
        const getStringValues = (colName: string): string[] => {
          const idx = columns.findIndex((c: string) => c.toLowerCase() === colName.toLowerCase());
          if (idx === -1) return [];
          return rows.map((r: any[]) => String(r[idx] ?? ''));
        };

        const median = (arr: number[]): number => {
          const sorted = [...arr].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        };

        const percentile = (arr: number[], p: number): number => {
          const sorted = [...arr].sort((a, b) => a - b);
          const idx = (p / 100) * (sorted.length - 1);
          const lower = Math.floor(idx);
          const frac = idx - lower;
          return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * frac;
        };

        switch (args.operation) {
          case 'summary': {
            const stats = targetCols.map(col => {
              const nums = getNumericValues(col);
              if (nums.length === 0) {
                const strs = getStringValues(col);
                const uniqueCount = new Set(strs).size;
                return { column: col, type: 'categorical', count: strs.length, unique: uniqueCount, topValues: [...new Set(strs)].slice(0, 8) };
              }
              const sum = nums.reduce((a, b) => a + b, 0);
              const avg = sum / nums.length;
              const sorted = [...nums].sort((a, b) => a - b);
              const stddev = Math.sqrt(nums.reduce((acc, v) => acc + (v - avg) ** 2, 0) / nums.length);
              return {
                column: col, type: 'numeric', count: nums.length,
                sum: Math.round(sum * 100) / 100, avg: Math.round(avg * 100) / 100,
                min: sorted[0], max: sorted[sorted.length - 1],
                median: Math.round(median(nums) * 100) / 100,
                stddev: Math.round(stddev * 100) / 100,
              };
            });
            return JSON.stringify({ operation: 'summary', stats, totalRows: rows.length });
          }

          case 'distribution': {
            const col = targetCols[0];
            const nums = getNumericValues(col);
            if (nums.length === 0) return JSON.stringify({ error: `No numeric values in column "${col}"` });
            const binCount = args.n || 10;
            const min = Math.min(...nums);
            const max = Math.max(...nums);
            const binWidth = (max - min) / binCount || 1;
            const bins = Array.from({ length: binCount }, (_, i) => ({
              binStart: Math.round((min + i * binWidth) * 100) / 100,
              binEnd: Math.round((min + (i + 1) * binWidth) * 100) / 100,
              count: 0,
            }));
            for (const v of nums) {
              const idx = Math.min(Math.floor((v - min) / binWidth), binCount - 1);
              bins[idx].count++;
            }
            return JSON.stringify({ operation: 'distribution', column: col, bins, totalValues: nums.length });
          }

          case 'percentiles': {
            const col = targetCols[0];
            const nums = getNumericValues(col);
            if (nums.length === 0) return JSON.stringify({ error: `No numeric values in column "${col}"` });
            return JSON.stringify({
              operation: 'percentiles', column: col, count: nums.length,
              p10: Math.round(percentile(nums, 10) * 100) / 100,
              p25: Math.round(percentile(nums, 25) * 100) / 100,
              p50: Math.round(percentile(nums, 50) * 100) / 100,
              p75: Math.round(percentile(nums, 75) * 100) / 100,
              p90: Math.round(percentile(nums, 90) * 100) / 100,
              min: Math.min(...nums), max: Math.max(...nums),
            });
          }

          case 'correlation': {
            if (targetCols.length < 2) return JSON.stringify({ error: 'Need at least 2 columns for correlation' });
            const pairs: { col1: string; col2: string; r: number; strength: string }[] = [];
            for (let i = 0; i < targetCols.length; i++) {
              for (let j = i + 1; j < targetCols.length; j++) {
                const xVals = getNumericValues(targetCols[i]);
                const yVals = getNumericValues(targetCols[j]);
                const n = Math.min(xVals.length, yVals.length);
                if (n < 3) continue;
                const xMean = xVals.slice(0, n).reduce((a, b) => a + b, 0) / n;
                const yMean = yVals.slice(0, n).reduce((a, b) => a + b, 0) / n;
                let num = 0, denX = 0, denY = 0;
                for (let k = 0; k < n; k++) {
                  const dx = xVals[k] - xMean;
                  const dy = yVals[k] - yMean;
                  num += dx * dy;
                  denX += dx * dx;
                  denY += dy * dy;
                }
                const r = denX && denY ? Math.round((num / Math.sqrt(denX * denY)) * 1000) / 1000 : 0;
                const absR = Math.abs(r);
                const strength = absR > 0.7 ? 'strong' : absR > 0.4 ? 'moderate' : 'weak';
                pairs.push({ col1: targetCols[i], col2: targetCols[j], r, strength });
              }
            }
            pairs.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
            return JSON.stringify({ operation: 'correlation', pairs });
          }

          case 'groupBy': {
            const groupCol = args.groupByColumn || targetCols[0];
            const measureCol = targetCols.find(c => c.toLowerCase() !== groupCol.toLowerCase()) || targetCols[0];
            const aggFn = args.aggregation || 'sum';
            const groupIdx = columns.findIndex((c: string) => c.toLowerCase() === groupCol.toLowerCase());
            const measureIdx = columns.findIndex((c: string) => c.toLowerCase() === measureCol.toLowerCase());
            if (groupIdx === -1 || measureIdx === -1) return JSON.stringify({ error: `Column not found` });

            const groups = new Map<string, number[]>();
            for (const row of rows) {
              const key = String(row[groupIdx] ?? '');
              const val = parseNum(row[measureIdx]);
              if (val !== null) {
                const arr = groups.get(key) || [];
                arr.push(val);
                groups.set(key, arr);
              }
            }

            const results = [...groups.entries()].map(([key, vals]) => {
              const sum = vals.reduce((a, b) => a + b, 0);
              let value: number;
              switch (aggFn) {
                case 'avg': value = sum / vals.length; break;
                case 'count': value = vals.length; break;
                case 'min': value = Math.min(...vals); break;
                case 'max': value = Math.max(...vals); break;
                case 'median': value = median(vals); break;
                default: value = sum;
              }
              return { group: key, value: Math.round(value * 100) / 100, count: vals.length };
            });

            const dir = args.sortDirection || 'desc';
            results.sort((a, b) => dir === 'desc' ? b.value - a.value : a.value - b.value);

            return JSON.stringify({
              operation: 'groupBy', groupColumn: groupCol, measureColumn: measureCol,
              aggregation: aggFn, groups: results.slice(0, args.n || 50),
            });
          }

          case 'topN': {
            const measureCol = targetCols[0];
            const n = args.n || 10;
            const measureIdx = columns.findIndex((c: string) => c.toLowerCase() === measureCol.toLowerCase());
            if (measureIdx === -1) return JSON.stringify({ error: `Column "${measureCol}" not found` });

            const items = rows.map((row: any[]) => {
              const val = parseNum(row[measureIdx]);
              return { row: row.slice(0, 6), value: val };
            }).filter((i: any) => i.value !== null);

            const dir = args.sortDirection || 'desc';
            items.sort((a: any, b: any) => dir === 'desc' ? b.value - a.value : a.value - b.value);

            return JSON.stringify({
              operation: 'topN', column: measureCol, direction: dir,
              items: items.slice(0, n).map((i: any, rank: number) => ({
                rank: rank + 1, value: i.value,
                label: i.row[0], columns: columns.slice(0, 6), row: i.row,
              })),
            });
          }

          case 'outliers': {
            const col = targetCols[0];
            const nums = getNumericValues(col);
            if (nums.length < 4) return JSON.stringify({ error: 'Need at least 4 values for outlier detection' });
            const q1 = percentile(nums, 25);
            const q3 = percentile(nums, 75);
            const iqr = q3 - q1;
            const lower = q1 - 1.5 * iqr;
            const upper = q3 + 1.5 * iqr;
            const colIdx = columns.findIndex((c: string) => c.toLowerCase() === col.toLowerCase());
            const outlierRows = rows.filter((row: any[]) => {
              const v = parseNum(row[colIdx]);
              return v !== null && (v < lower || v > upper);
            }).slice(0, 20).map((row: any[]) => ({ label: row[0], value: parseNum(row[colIdx]), row: row.slice(0, 6) }));

            return JSON.stringify({
              operation: 'outliers', column: col,
              q1: Math.round(q1 * 100) / 100, q3: Math.round(q3 * 100) / 100,
              iqr: Math.round(iqr * 100) / 100,
              lowerBound: Math.round(lower * 100) / 100, upperBound: Math.round(upper * 100) / 100,
              outlierCount: outlierRows.length, outliers: outlierRows,
            });
          }

          case 'pivot': {
            const groupCol = args.groupByColumn || targetCols[0];
            const pivotCol = targetCols[1] || targetCols[0];
            const measureCol = targetCols[2] || targetCols[0];
            const aggFn = args.aggregation || 'sum';
            const gIdx = columns.findIndex((c: string) => c.toLowerCase() === groupCol.toLowerCase());
            const pIdx = columns.findIndex((c: string) => c.toLowerCase() === pivotCol.toLowerCase());
            const mIdx = columns.findIndex((c: string) => c.toLowerCase() === measureCol.toLowerCase());
            if (gIdx === -1 || pIdx === -1) return JSON.stringify({ error: 'Pivot columns not found' });

            const pivotValues = [...new Set(rows.map((r: any[]) => String(r[pIdx] ?? '')))].slice(0, 20);
            const pivotMap = new Map<string, Map<string, number[]>>();

            for (const row of rows) {
              const g = String(row[gIdx] ?? '');
              const p = String(row[pIdx] ?? '');
              const v = parseNum(row[mIdx]) ?? 0;
              if (!pivotMap.has(g)) pivotMap.set(g, new Map());
              const inner = pivotMap.get(g)!;
              if (!inner.has(p)) inner.set(p, []);
              inner.get(p)!.push(v);
            }

            const pivotRows = [...pivotMap.entries()].map(([group, inner]) => {
              const entry: Record<string, any> = { group };
              for (const pv of pivotValues) {
                const vals = inner.get(pv) || [];
                const sum = vals.reduce((a, b) => a + b, 0);
                entry[pv] = aggFn === 'avg' ? Math.round((sum / (vals.length || 1)) * 100) / 100
                  : aggFn === 'count' ? vals.length : Math.round(sum * 100) / 100;
              }
              return entry;
            });

            return JSON.stringify({
              operation: 'pivot', groupColumn: groupCol, pivotColumn: pivotCol,
              measureColumn: measureCol, aggregation: aggFn,
              pivotValues, rows: pivotRows.slice(0, 50),
            });
          }

          case 'timeSeries': {
            const dateCol = args.dateColumn || targetCols[0];
            const measureCol = targetCols.find(c => c.toLowerCase() !== dateCol.toLowerCase()) || targetCols[0];
            const period = args.periodGrouping || 'month';
            const dIdx = columns.findIndex((c: string) => c.toLowerCase() === dateCol.toLowerCase());
            const mIdx = columns.findIndex((c: string) => c.toLowerCase() === measureCol.toLowerCase());
            if (dIdx === -1 || mIdx === -1) return JSON.stringify({ error: 'Column not found' });

            const periodMap = new Map<string, number[]>();
            for (const row of rows) {
              const dateStr = String(row[dIdx] ?? '');
              const val = parseNum(row[mIdx]);
              if (val === null) continue;
              const d = new Date(dateStr);
              if (isNaN(d.getTime())) continue;
              let key: string;
              switch (period) {
                case 'day': key = d.toISOString().slice(0, 10); break;
                case 'week': { const w = new Date(d); w.setDate(w.getDate() - w.getDay()); key = w.toISOString().slice(0, 10); break; }
                case 'quarter': key = `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`; break;
                case 'year': key = String(d.getFullYear()); break;
                default: key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              }
              const arr = periodMap.get(key) || [];
              arr.push(val);
              periodMap.set(key, arr);
            }

            const aggFn = args.aggregation || 'sum';
            const series = [...periodMap.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([period, vals]) => {
                const sum = vals.reduce((a, b) => a + b, 0);
                const value = aggFn === 'avg' ? sum / vals.length : aggFn === 'count' ? vals.length : sum;
                return { period, value: Math.round(value * 100) / 100, count: vals.length };
              });

            // Add period-over-period change
            const withChange = series.map((s, i) => ({
              ...s,
              change: i > 0 ? Math.round((s.value - series[i - 1].value) * 100) / 100 : 0,
              changePct: i > 0 && series[i - 1].value ? Math.round(((s.value - series[i - 1].value) / series[i - 1].value) * 10000) / 100 : 0,
            }));

            return JSON.stringify({
              operation: 'timeSeries', dateColumn: dateCol, measureColumn: measureCol,
              periodGrouping: period, aggregation: aggFn, series: withChange,
            });
          }

          case 'frequency': {
            const col = targetCols[0];
            const vals = getStringValues(col);
            const freqMap = new Map<string, number>();
            for (const v of vals) {
              freqMap.set(v, (freqMap.get(v) || 0) + 1);
            }
            const items = [...freqMap.entries()]
              .map(([value, count]) => ({ value, count, pct: Math.round((count / vals.length) * 10000) / 100 }))
              .sort((a, b) => b.count - a.count)
              .slice(0, args.n || 30);

            return JSON.stringify({
              operation: 'frequency', column: col, totalValues: vals.length,
              uniqueValues: freqMap.size, items,
            });
          }

          default:
            return JSON.stringify({ error: `Unknown stats operation: ${args.operation}` });
        }
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
