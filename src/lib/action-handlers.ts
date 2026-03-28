/**
 * Action Handlers — extracted from useWorkspaceActions.applyResult.
 *
 * Each handler is a pure-ish async function that receives workspace state
 * and returns dispatch instructions. This makes them testable without
 * React hooks and keeps the intent pipeline readable.
 *
 * Pipeline: parse intent → resolve data → materialize → observe
 */
import { z } from 'zod';
import { WorkspaceObject } from './workspace-types';
import { callAI } from '@/hooks/useAI';
import { getActiveDataset } from './active-dataset';
import { previewRows, alertRows, metricAggregate, comparisonPairs } from './data-slicer';
import { executeFusion } from './fusion-executor';
import { getFusionOutputType } from './fusion-rules';
import { refineDataRules } from './intent-engine';
import { DataProfile } from './data-analyzer';
import { CardSectionType, validateSections } from './card-schema';
import { executeDataQuery } from './data-query';
import {
  buildDefaultViewState,
  buildObjectPromptSummary,
  getObjectViewState,
  ObjectViewState,
} from './workspace-intelligence';

/** Dispatch instruction returned by handlers */
export interface DispatchInstruction {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  dataQuery?: any;
  sections?: any[];
  sectionOperations?: { op: string; section?: CardSectionType; sectionIndex?: number; dataQuery?: any }[];
}

const ViewUpdatePlanSchema = z.object({
  limit: z.number().int().positive().nullable().optional(),
  tierFilter: z.string().min(1).nullable().optional(),
  textSearch: z.string().min(1).nullable().optional(),
  columnFilter: z.object({ column: z.string().min(1), value: z.string().min(1) }).nullable().optional(),
  sortBy: z.string().min(1).nullable().optional(),
  sortDirection: z.enum(['asc', 'desc']).nullable().optional(),
  preferredColumns: z.array(z.string().min(1)).min(1).nullable().optional(),
  displayMode: z.enum(['table', 'chart']).nullable().optional(),
  chartType: z.enum(['bar', 'line', 'area']).nullable().optional(),
  chartXAxis: z.string().min(1).nullable().optional(),
  chartYAxis: z.string().min(1).nullable().optional(),
  resetFilters: z.boolean().optional(),
}).partial();

const ContentUpdatePlanSchema = z.object({
  regenerateNarrative: z.boolean().optional(),
  reframePrompt: z.string().min(1).nullable().optional(),
}).partial();

const UpdatePlanSchema = z.object({
  response: z.string().min(1).nullable().optional(),
  renameTo: z.string().min(1).nullable().optional(),
  view: ViewUpdatePlanSchema.optional(),
  content: ContentUpdatePlanSchema.optional(),
});

type UpdatePlan = z.infer<typeof UpdatePlanSchema>;

/**
 * Parse a user instruction into a structured update plan, then apply it.
 */
export async function handleUpdate({ target, instruction, documentIds, dataQuery, sections, sectionOperations }: UpdateParams): Promise<HandlerResult> {
  // FAST PATH: If the AI already provided a dataQuery, apply it directly — no second AI call needed
  if (dataQuery) {
    const result = executeDataQuery(dataQuery);
    const newContext = {
      ...target.context,
      columns: result.columns,
      rows: result.rows,
      dataQuery,
      queryMeta: { totalMatched: result.totalMatched, truncated: result.truncated },
    };
    return {
      dispatches: [
        { type: 'UPDATE_OBJECT_CONTEXT', payload: { id: target.id, context: newContext } },
        { type: 'TOUCH_OBJECT', payload: { id: target.id } },
        { type: 'FOCUS_OBJECT', payload: { id: target.id } },
        { type: 'SET_SHERPA_RESPONSE', payload: `Updated "${target.title}" — ${instruction}.` },
      ],
    };
  }

  // FAST PATH: If the AI provided replacement sections, apply directly
  if (sections && sections.length > 0) {
    const { validateSections } = await import('./card-schema');
    const validSections = validateSections(sections);
    return {
      dispatches: [
        { type: 'UPDATE_OBJECT_CONTEXT', payload: { id: target.id, context: { ...target.context, sections: validSections } } },
        { type: 'TOUCH_OBJECT', payload: { id: target.id } },
        { type: 'FOCUS_OBJECT', payload: { id: target.id } },
        { type: 'SET_SHERPA_RESPONSE', payload: `Updated "${target.title}" — ${instruction}.` },
      ],
    };
  }

  // Handle section-level operations on analysis cards
  if (sectionOperations && target.context?.sections) {
    const sections: CardSectionType[] = [...target.context.sections];
    for (const op of sectionOperations) {
      switch (op.op) {
        case 'add':
          if (op.section) sections.push(op.section);
          break;
        case 'remove':
          if (op.sectionIndex != null && op.sectionIndex >= 0 && op.sectionIndex < sections.length) {
            sections.splice(op.sectionIndex, 1);
          }
          break;
        case 'replace':
          if (op.sectionIndex != null && op.section && op.sectionIndex >= 0 && op.sectionIndex < sections.length) {
            sections[op.sectionIndex] = op.section;
          }
          break;
        case 'requery':
          if (op.dataQuery) {
            const result = executeDataQuery(op.dataQuery);
            const tableIdx = sections.findIndex(s => s.type === 'table');
            if (tableIdx >= 0) {
              sections[tableIdx] = { ...sections[tableIdx], columns: result.columns, rows: result.rows } as CardSectionType;
            }
          }
          break;
      }
    }
    return {
      dispatches: [
        { type: 'UPDATE_OBJECT', payload: { id: target.id, context: { ...target.context, sections } } },
        { type: 'TOUCH_OBJECT', payload: { id: target.id } },
        { type: 'FOCUS_OBJECT', payload: { id: target.id } },
        { type: 'SET_SHERPA_RESPONSE', payload: `Updated "${target.title}" — ${instruction}.` },
      ],
    };
  }

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

  const currentView = {
    ...buildDefaultViewState(target.type, target.context, profile),
    ...getObjectViewState(target.context),
  };

  const parseResult = await callAI(
    [{ role: 'user', content: `Target object summary:
${JSON.stringify(buildObjectPromptSummary(target, profile, target.id), null, 2)}

Current persisted view state:
${JSON.stringify(currentView, null, 2)}

Dataset profile:
${JSON.stringify({
  domain: profile.domain,
  primaryIdColumn: profile.primaryIdColumn,
  primaryMeasureColumn: profile.primaryMeasureColumn,
  groupByColumn: profile.groupByColumn,
  displayColumns: profile.displayColumns,
  ordinalPriorityColumn: profile.ordinalPriorityColumn,
}, null, 2)}

Available dataset columns: ${columns.join(', ')}

User instruction: "${instruction}"

Return ONLY valid JSON with this shape:
{
  "response": "short user-facing confirmation sentence",
  "renameTo": "new object title or null",
  "view": {
    "limit": number | null,
    "tierFilter": string | null,
    "textSearch": string | null,
    "columnFilter": { "column": string, "value": string } | null,
    "sortBy": string | null,
    "sortDirection": "asc" | "desc" | null,
    "preferredColumns": string[] | null,
    "displayMode": "table" | "chart" | null,
    "chartType": "bar" | "line" | "area" | null,
    "chartXAxis": string | null,
    "chartYAxis": string | null,
    "resetFilters": boolean
  },
  "content": {
    "regenerateNarrative": boolean,
    "reframePrompt": "optional reframing guidance or null"
  }
}

Rules:
- Only include fields the user explicitly wants to change.
- Use null to CLEAR an existing persisted setting.
- Use content.regenerateNarrative when the user wants a brief/comparison/metric rewritten or reframed.
- Use view.preferredColumns for changing visible columns.
- Use displayMode/chartType/chartXAxis/chartYAxis for chart requests.
- If the instruction is purely a rename, do not invent filter changes.
- If the instruction is purely a filter/sort/display change, do not invent a rename.` }],
    'update-plan'
  );

  const plan = parseUpdatePlan(parseResult);
  const nextView = mergeViewState(currentView, plan.view);
  const updated = await applyUpdateToObject({
    target,
    columns,
    rows,
    profile,
    view: nextView,
    instruction,
    documentIds,
    plan,
  });

  const response = plan.response || buildDefaultUpdateResponse(target.title, instruction, plan);

  return {
    dispatches: [
      {
        type: 'UPDATE_OBJECT',
        payload: {
          id: target.id,
          title: updated.title,
          context: updated.context,
        },
      },
      { type: 'TOUCH_OBJECT', payload: { id: target.id } },
      { type: 'FOCUS_OBJECT', payload: { id: target.id } },
      { type: 'SET_SHERPA_RESPONSE', payload: response },
    ],
  };
}

function parseUpdatePlan(result: string | null): UpdatePlan {
  if (!result) return {};
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return {};
    const parsed = JSON.parse(jsonMatch[0]);
    const validated = UpdatePlanSchema.safeParse(parsed);
    if (!validated.success) {
      console.warn('[action-handlers] AI returned invalid update plan:', validated.error.issues);
      return {};
    }
    return validated.data;
  } catch (e) {
    console.warn('[action-handlers] AI returned unparseable update JSON:', e);
    return {};
  }
}

function mergeViewState(current: ObjectViewState, next?: UpdatePlan['view']): ObjectViewState {
  const merged: ObjectViewState = { ...current };
  if (!next) return merged;

  if (next.resetFilters) {
    delete merged.tierFilter;
    delete merged.textSearch;
    delete merged.columnFilter;
  }

  const assign = <K extends keyof ObjectViewState>(key: K, value: ObjectViewState[K] | null | undefined) => {
    if (value === undefined) return;
    if (value === null) {
      delete merged[key];
      return;
    }
    merged[key] = value;
  };

  assign('limit', next.limit);
  assign('tierFilter', next.tierFilter);
  assign('textSearch', next.textSearch);
  assign('columnFilter', next.columnFilter);
  assign('sortBy', next.sortBy);
  assign('sortDirection', next.sortDirection);
  assign('preferredColumns', next.preferredColumns);
  assign('displayMode', next.displayMode);
  assign('chartType', next.chartType);
  assign('chartXAxis', next.chartXAxis);
  assign('chartYAxis', next.chartYAxis);

  return merged;
}

function parseSortableValue(value: string): number | string {
  const trimmed = value.trim();
  const numeric = Number(trimmed.replace(/[$,%]/g, '').replace(/,/g, ''));
  if (!Number.isNaN(numeric) && trimmed !== '') return numeric;
  return trimmed.toLowerCase();
}

function applyViewToRows(
  sourceRows: string[][],
  columns: string[],
  profile: DataProfile,
  view: ObjectViewState
): string[][] {
  let filtered = sourceRows;

  if (view.tierFilter && profile.ordinalPriorityColumn) {
    const colIdx = columns.indexOf(profile.ordinalPriorityColumn.column);
    if (colIdx >= 0) {
      filtered = filtered.filter(r => String(r[colIdx]).includes(view.tierFilter!));
    }
  }

  if (view.columnFilter) {
    const colIdx = columns.indexOf(view.columnFilter.column);
    if (colIdx >= 0) {
      const val = view.columnFilter.value.toLowerCase();
      filtered = filtered.filter(r => String(r[colIdx]).toLowerCase().includes(val));
    }
  }

  if (view.textSearch) {
    const lower = view.textSearch.toLowerCase();
    filtered = filtered.filter(r => r.some(cell => String(cell).toLowerCase().includes(lower)));
  }

  const explicitlySorted = view.sortBy ? columns.indexOf(view.sortBy) : -1;
  if (explicitlySorted >= 0) {
    filtered = [...filtered].sort((rowA, rowB) => {
      const valueA = parseSortableValue(String(rowA[explicitlySorted] ?? ''));
      const valueB = parseSortableValue(String(rowB[explicitlySorted] ?? ''));

      if (typeof valueA === 'number' && typeof valueB === 'number') {
        return view.sortDirection === 'asc' ? valueA - valueB : valueB - valueA;
      }

      const comparison = String(valueA).localeCompare(String(valueB), undefined, { numeric: true });
      return view.sortDirection === 'asc' ? comparison : -comparison;
    });
  } else {
    filtered = previewRows(columns, filtered, profile, filtered.length).rows;
  }

  return view.limit ? filtered.slice(0, view.limit) : filtered;
}

async function refreshMetricNarrative(
  target: WorkspaceObject,
  nextContext: Record<string, unknown>,
  instruction: string,
  profile: DataProfile
): Promise<string | undefined> {
  const result = await callAI(
    [{ role: 'user', content: `You are updating a metric card narrative.

Metric snapshot:
${JSON.stringify({
  title: target.title,
  domain: profile.domain,
  primaryMeasureColumn: profile.primaryMeasureColumn,
  currentValue: nextContext.currentValue,
  unit: nextContext.unit,
  change: nextContext.change,
  trend: nextContext.trend,
  breakdown: nextContext.breakdown,
}, null, 2)}

User instruction: "${instruction}"

Return ONLY one concise paragraph for the metric's explanatory text.` }],
    'dataset'
  );

  return result?.trim() || undefined;
}

async function refreshComparisonHighlights(
  target: WorkspaceObject,
  nextContext: Record<string, unknown>,
  instruction: string,
  profile: DataProfile
): Promise<{ title?: string; highlights?: { metric: string; insight: string }[] }> {
  const result = await callAI(
    [{ role: 'user', content: `You are updating a comparison object.

Comparison snapshot:
${JSON.stringify({
  title: target.title,
  domain: profile.domain,
  entities: nextContext.entities,
  currentHighlights: nextContext.highlights,
}, null, 2)}

User instruction: "${instruction}"

Return ONLY valid JSON:
{
  "title": "optional refreshed title or null",
  "highlights": [{ "insight": "short analytical insight" }]
}` }],
    'dataset'
  );

  if (!result) return {};

  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return {};
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : undefined,
      highlights: Array.isArray(parsed.highlights)
        ? parsed.highlights
          .map((item: unknown) => ({ metric: String((item as { metric?: string }).metric || ''), insight: String((item as { insight?: string }).insight || '').trim() }))
            .filter((item: { metric: string; insight: string }) => item.insight.length > 0)
        : undefined,
    };
  } catch (error) {
    console.warn('[action-handlers] Failed to parse comparison refresh JSON:', error);
    return {};
  }
}

async function refreshBriefContent(
  target: WorkspaceObject,
  supportingRows: string[][],
  columns: string[],
  profile: DataProfile,
  instruction: string,
  documentIds: string[]
): Promise<string | undefined> {
  const preview = supportingRows.slice(0, 12);
  const tablePreview = [columns.join(' | '), ...preview.map((row) => row.join(' | '))].join('\n');
  const result = await callAI(
    [{ role: 'user', content: `Update this analytical brief.

Current title: ${target.title}
Current content:
${String(target.context.content || target.context.summary || '')}

Dataset domain: ${profile.domain}
Relevant rows:
${tablePreview}

User instruction: "${instruction}"

Return ONLY markdown for the refreshed brief. Keep it concise, analytical, and grounded in the supplied data.` }],
    'brief',
    documentIds
  );

  return result?.trim() || undefined;
}

function buildDefaultUpdateResponse(title: string, instruction: string, plan: UpdatePlan): string {
  if (plan.renameTo) {
    return `Updated "${title}" and renamed it to "${plan.renameTo}".`;
  }
  return `Updated "${title}" — ${instruction}.`;
}

async function applyUpdateToObject(params: {
  target: WorkspaceObject;
  profile: DataProfile,
  columns: string[];
  rows: string[][];
  view: ObjectViewState;
  instruction: string,
  documentIds: string[];
  plan: UpdatePlan;
}): Promise<{ context: Record<string, unknown>; title?: string }> {
  const { target, columns, rows, profile, view, instruction, documentIds, plan } = params;
  const nextView = Object.keys(view).length > 0 ? view : buildDefaultViewState(target.type, target.context, profile);
  const filteredRows = applyViewToRows(rows, columns, profile, nextView);
  const storedView = Object.keys(nextView).length > 0 ? nextView : undefined;

  switch (target.type) {
    case 'inspector':
    case 'dataset': {
      return {
        title: plan.renameTo || undefined,
        context: {
          ...target.context,
          columns,
          rows: filteredRows,
          view: storedView,
        },
      };
    }
    case 'alert': {
      const alerts = alertRows(columns, filteredRows, profile);
      return {
        title: plan.renameTo || undefined,
        context: {
          ...target.context,
          alerts,
          view: storedView,
        },
      };
    }
    case 'comparison': {
      let context = {
        ...comparisonPairs(columns, filteredRows, profile),
        view: storedView,
      };

      if (plan.content?.regenerateNarrative || plan.content?.reframePrompt) {
        const refreshed = await refreshComparisonHighlights(target, context, plan.content?.reframePrompt || instruction, profile);
        context = {
          ...context,
          highlights: refreshed.highlights || context.highlights,
        };
        return {
          title: plan.renameTo || refreshed.title || undefined,
          context,
        };
      }

      return {
        title: plan.renameTo || undefined,
        context,
      };
    }
    case 'brief': {
      const regenerated = await refreshBriefContent(target, filteredRows, columns, profile, plan.content?.reframePrompt || instruction, documentIds);
      return {
        title: plan.renameTo || undefined,
        context: {
          ...target.context,
          content: regenerated || target.context.content,
          view: storedView,
        },
      };
    }
    case 'metric': {
      const agg = metricAggregate(columns, filteredRows, profile);
      let context = { ...target.context, ...agg, view: storedView };
      if (plan.content?.regenerateNarrative || plan.content?.reframePrompt || storedView?.tierFilter || storedView?.columnFilter || storedView?.textSearch) {
        const refreshed = await refreshMetricNarrative(target, context, plan.content?.reframePrompt || instruction, profile);
        context = { ...context, context: refreshed || context.context };
      }
      return {
        title: plan.renameTo || undefined,
        context,
      };
    }
    default:
      return {
        title: plan.renameTo || undefined,
        context: {
          ...target.context,
          view: storedView,
        },
      };
  }
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
          type: getFusionOutputType(objA.type, objB.type),
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
    let newContext: Record<string, unknown> = obj.context;
    switch (obj.type) {
      case 'metric': {
        const agg = metricAggregate(columns, rows, updatedProfile);
        newContext = { ...obj.context, ...agg, view: obj.context.view };
        break;
      }
      case 'inspector': {
        const preview = previewRows(columns, rows, updatedProfile, 8);
        newContext = { ...obj.context, columns: preview.columns, rows: preview.rows, view: obj.context.view };
        break;
      }
      case 'alert': {
        const alerts = alertRows(columns, rows, updatedProfile);
        newContext = { ...obj.context, alerts, view: obj.context.view };
        break;
      }
      case 'comparison': {
        const comp = comparisonPairs(columns, rows, updatedProfile);
        newContext = { ...comp, view: obj.context.view };
        break;
      }
    }
    dispatches.push({ type: 'UPDATE_OBJECT_CONTEXT', payload: { id: obj.id, context: newContext } });
  }

  const changes: string[] = [];
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
