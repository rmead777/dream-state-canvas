/**
 * Action Handlers — extracted from useWorkspaceActions.applyResult.
 *
 * Each handler is a pure-ish async function that receives workspace state
 * and returns dispatch instructions. This makes them testable without
 * React hooks and keeps the intent pipeline readable.
 *
 * Pipeline: parse intent → resolve data → materialize → observe
 */
import { WorkspaceObject } from './workspace-types';
import { callAI } from '@/hooks/useAI';
import { getActiveDataset } from './active-dataset';
import { previewRows, alertRows, metricAggregate, comparisonPairs } from './data-slicer';
import { executeFusion, FusionResult } from './fusion-executor';
import { refineDataRules } from './intent-engine';
import { DataProfile } from './data-analyzer';

/** Dispatch instruction returned by handlers */
export interface DispatchInstruction {
  type: string;
  payload?: any;
}

/** Result of an action handler */
export interface HandlerResult {
  dispatches: DispatchInstruction[];
  toasts?: { title: string; description?: string }[];
}

// ─── Update Handler ─────────────────────────────────────────────────────────

interface UpdateParams {
  target: WorkspaceObject;
  instruction: string;
  documentIds: string[];
}

/**
 * Parse filter instruction via AI, apply to data, return updated context.
 */
export async function handleUpdate({ target, instruction, documentIds }: UpdateParams): Promise<HandlerResult> {
  const { columns, rows } = getActiveDataset();
  const { getCurrentProfile } = await import('./data-analyzer');
  const profile = getCurrentProfile(columns, rows);

  if (!profile) {
    return {
      dispatches: [
        { type: 'SET_SHERPA_RESPONSE', payload: `Cannot update "${target.title}" — data profile not ready yet. Try again in a moment.` },
      ],
    };
  }

  // AI-powered filter parsing
  const parseResult = await callAI(
    [{ role: 'user', content: `You are a data filter parser. Given a user instruction about modifying a data view, extract structured filter parameters.

Instruction: "${instruction}"

Available columns in the dataset: ${columns.join(', ')}

Return ONLY valid JSON (no markdown, no explanation):
{
  "limit": <number or null - how many rows to show>,
  "tierFilter": "<exact tier label to filter by, e.g. 'Tier 1' — or null>",
  "columnFilter": { "column": "<column name>", "value": "<filter value>" } or null,
  "sortBy": "<column name or null>",
  "sortDirection": "<'asc' or 'desc' or null>",
  "textSearch": "<keyword to search across all columns, or null>"
}` }],
    'intent'
  );

  const filters = parseFilterResult(parseResult);
  const newContext = applyUpdateToObject(target, columns, rows, profile, filters, instruction, documentIds);
  const resolvedContext = newContext instanceof Promise ? await newContext : newContext;

  return {
    dispatches: [
      { type: 'UPDATE_OBJECT_CONTEXT', payload: { id: target.id, context: resolvedContext } },
      { type: 'TOUCH_OBJECT', payload: { id: target.id } },
      { type: 'FOCUS_OBJECT', payload: { id: target.id } },
      { type: 'SET_SHERPA_RESPONSE', payload: `Updated "${target.title}" — ${instruction}.` },
    ],
  };
}

interface ParsedFilters {
  limit?: number;
  tierFilter?: string;
  textSearch?: string;
  columnFilter?: { column: string; value: string };
}

function parseFilterResult(result: string | null): ParsedFilters {
  if (!result) return {};
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return {};
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      limit: parsed.limit || undefined,
      tierFilter: parsed.tierFilter || undefined,
      textSearch: parsed.textSearch || undefined,
      columnFilter: parsed.columnFilter?.column && parsed.columnFilter?.value
        ? parsed.columnFilter
        : undefined,
    };
  } catch (e) {
    console.warn('[action-handlers] AI returned unparseable filter JSON:', e);
    return {};
  }
}

function applyFiltersToRows(
  sourceRows: string[][],
  columns: string[],
  profile: DataProfile,
  filters: ParsedFilters
): string[][] {
  let filtered = sourceRows;
  if (filters.tierFilter && profile.ordinalPriorityColumn) {
    const colIdx = columns.indexOf(profile.ordinalPriorityColumn.column);
    if (colIdx >= 0) {
      filtered = filtered.filter(r => String(r[colIdx]).includes(filters.tierFilter!));
    }
  }
  if (filters.columnFilter) {
    const colIdx = columns.indexOf(filters.columnFilter.column);
    if (colIdx >= 0) {
      const val = filters.columnFilter.value.toLowerCase();
      filtered = filtered.filter(r => String(r[colIdx]).toLowerCase().includes(val));
    }
  }
  if (filters.textSearch) {
    const lower = filters.textSearch.toLowerCase();
    filtered = filtered.filter(r => r.some(cell => String(cell).toLowerCase().includes(lower)));
  }
  const sorted = previewRows(columns, filtered, profile, filtered.length);
  return filters.limit ? sorted.rows.slice(0, filters.limit) : sorted.rows;
}

function applyUpdateToObject(
  target: WorkspaceObject,
  columns: string[],
  rows: string[][],
  profile: DataProfile,
  filters: ParsedFilters,
  instruction: string,
  documentIds: string[]
): Record<string, any> | Promise<Record<string, any>> {
  switch (target.type) {
    case 'inspector':
    case 'dataset': {
      const filteredRows = applyFiltersToRows(rows, columns, profile, filters);
      return { columns, rows: filteredRows };
    }
    case 'alert': {
      let filteredRows = rows;
      if (filters.tierFilter && profile.ordinalPriorityColumn) {
        const colIdx = columns.indexOf(profile.ordinalPriorityColumn.column);
        if (colIdx >= 0) {
          filteredRows = filteredRows.filter(r => String(r[colIdx]).includes(filters.tierFilter!));
        }
      }
      const alerts = alertRows(columns, filteredRows, profile);
      return { alerts: filters.limit ? alerts.slice(0, filters.limit) : alerts };
    }
    case 'comparison':
      return comparisonPairs(columns, rows, profile);
    case 'brief':
      return handleBriefUpdate(target, columns, rows, profile, filters, instruction, documentIds);
    case 'metric': {
      const agg = metricAggregate(columns, rows, profile);
      return { ...target.context, ...agg };
    }
    default:
      return target.context;
  }
}

async function handleBriefUpdate(
  target: WorkspaceObject,
  columns: string[],
  rows: string[][],
  profile: DataProfile,
  filters: ParsedFilters,
  instruction: string,
  documentIds: string[]
): Promise<Record<string, any>> {
  let newContext = target.context;
  if (target.context.columns && target.context.rows) {
    const filteredRows = applyFiltersToRows(rows, columns, profile, filters);
    newContext = { ...target.context, columns, rows: filteredRows };
  }
  const briefResult = await callAI(
    [{ role: 'user', content: `Current brief context: ${JSON.stringify({ ...target.context, rows: target.context.rows?.slice(0, 10) })}\n\nUser instruction: "${instruction}"\n\nRegenerate the brief content incorporating this change. The data has been filtered to ${filters.limit ? `top ${filters.limit}` : 'match the criteria'}. Return ONLY markdown text, no JSON wrapper.` }],
    'brief',
    documentIds
  );
  if (briefResult) {
    newContext = { ...newContext, content: briefResult };
  }
  return newContext;
}

// ─── Fuse Handler ───────────────────────────────────────────────────────────

interface FuseParams {
  objA: WorkspaceObject;
  objB: WorkspaceObject;
  layoutMode: string;
}

export async function handleFuse({ objA, objB, layoutMode }: FuseParams): Promise<HandlerResult> {
  const result = await executeFusion(objA, objB);

  if (!result.success) {
    return {
      dispatches: [
        { type: 'SET_SHERPA_RESPONSE', payload: result.errorMessage || 'Fusion failed.' },
      ],
      toasts: result.lowValue ? [{ title: 'Fusion not productive', description: result.errorMessage }] : undefined,
    };
  }

  const freeformPosition =
    layoutMode === 'freeform'
      ? {
          x: ((objA.freeformPosition?.x ?? 200) + (objB.freeformPosition?.x ?? 400)) / 2,
          y: Math.max(objA.freeformPosition?.y ?? 100, objB.freeformPosition?.y ?? 100) + 120,
        }
      : undefined;

  return {
    dispatches: [
      {
        type: 'MATERIALIZE_OBJECT',
        payload: {
          id: result.id!,
          type: 'brief',
          title: result.title!,
          pinned: false,
          origin: { type: 'cross-object', sourceObjectId: objA.id, query: `Fusion of ${objA.title} and ${objB.title}` },
          relationships: [objA.id, objB.id],
          context: result.context!,
          position: { zone: 'primary', order: 0 },
          freeformPosition,
        },
      },
      { type: 'SET_SHERPA_RESPONSE', payload: `Synthesized "${objA.title}" and "${objB.title}" into a new insight.` },
    ],
  };
}

// ─── Refine Rules Handler ───────────────────────────────────────────────────

interface RefineRulesParams {
  feedback: string;
  objects: Record<string, WorkspaceObject>;
}

export async function handleRefineRules({ feedback, objects }: RefineRulesParams): Promise<HandlerResult> {
  const updatedProfile = await refineDataRules(feedback);
  const { columns, rows } = getActiveDataset();
  const dispatches: DispatchInstruction[] = [];
  const dataObjects = Object.values(objects).filter(
    o => ['metric', 'inspector', 'alert', 'comparison'].includes(o.type) && o.status !== 'dissolved'
  );

  for (const obj of dataObjects) {
    let newContext: Record<string, any> = obj.context;
    switch (obj.type) {
      case 'metric': {
        const agg = metricAggregate(columns, rows, updatedProfile);
        newContext = { ...obj.context, ...agg };
        break;
      }
      case 'inspector': {
        const preview = previewRows(columns, rows, updatedProfile, 8);
        newContext = { columns: preview.columns, rows: preview.rows };
        break;
      }
      case 'alert': {
        const alerts = alertRows(columns, rows, updatedProfile);
        newContext = { alerts };
        break;
      }
      case 'comparison': {
        const comp = comparisonPairs(columns, rows, updatedProfile);
        newContext = comp;
        break;
      }
    }
    dispatches.push({ type: 'UPDATE_OBJECT_CONTEXT', payload: { id: obj.id, context: newContext } });
  }

  const changes = [];
  if (updatedProfile.primaryMeasureColumn) changes.push(`sorting by ${updatedProfile.primaryMeasureColumn}`);
  if (updatedProfile.groupByColumn) changes.push(`grouping by ${updatedProfile.groupByColumn}`);
  if (updatedProfile.sortDirection) changes.push(`${updatedProfile.sortDirection}ending order`);

  dispatches.push({
    type: 'SET_SHERPA_RESPONSE',
    payload: `Rules updated: ${changes.join(', ')}. ${dataObjects.length} cards refreshed with new prioritization.`,
  });

  return {
    dispatches,
    toasts: [{ title: 'Rules updated', description: `Data prioritization refreshed for ${dataObjects.length} objects.` }],
  };
}
