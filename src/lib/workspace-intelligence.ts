import type { DataProfile } from './data-analyzer';
import type { ActiveContext, ObjectType, WorkspaceObject } from './workspace-types';

export type TableDisplayMode = 'table' | 'chart';
export type TableChartType = 'bar' | 'line' | 'area';

export interface ObjectViewState {
  limit?: number | null;
  tierFilter?: string | null;
  textSearch?: string | null;
  columnFilter?: { column: string; value: string } | null;
  sortBy?: string | null;
  sortDirection?: 'asc' | 'desc' | null;
  preferredColumns?: string[] | null;
  displayMode?: TableDisplayMode | null;
  chartType?: TableChartType | null;
  chartXAxis?: string | null;
  chartYAxis?: string | null;
  chartColor?: string | null;
  chartColors?: string[] | null;
  chartFillOpacity?: number | null;
  chartHeight?: number | null;
}

function truncate(value: unknown, max = 140): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== '')
  ) as Partial<T>;
}

function normalizeColumns(columns: unknown): string[] | undefined {
  if (!Array.isArray(columns)) return undefined;
  const normalized = columns.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeViewState(raw: Record<string, unknown> | undefined): ObjectViewState {
  if (!raw) return {};

  const preferredColumns = normalizeColumns(raw.preferredColumns);
  const displayMode = raw.displayMode === 'chart' || raw.displayMode === 'table'
    ? raw.displayMode
    : undefined;
  const chartType = raw.chartType === 'bar' || raw.chartType === 'line' || raw.chartType === 'area'
    ? raw.chartType
    : undefined;
  const sortDirection = raw.sortDirection === 'asc' || raw.sortDirection === 'desc'
    ? raw.sortDirection
    : undefined;

  return {
    limit: typeof raw.limit === 'number' ? raw.limit : undefined,
    tierFilter: typeof raw.tierFilter === 'string' ? raw.tierFilter : undefined,
    textSearch: typeof raw.textSearch === 'string' ? raw.textSearch : undefined,
    columnFilter:
      raw.columnFilter &&
      typeof raw.columnFilter === 'object' &&
      typeof (raw.columnFilter as { column?: unknown }).column === 'string' &&
      typeof (raw.columnFilter as { value?: unknown }).value === 'string'
        ? {
            column: (raw.columnFilter as { column: string }).column,
            value: (raw.columnFilter as { value: string }).value,
          }
        : undefined,
    sortBy: typeof raw.sortBy === 'string' ? raw.sortBy : undefined,
    sortDirection,
    preferredColumns,
    displayMode,
    chartType,
    chartXAxis: typeof raw.chartXAxis === 'string' ? raw.chartXAxis : undefined,
    chartYAxis: typeof raw.chartYAxis === 'string' ? raw.chartYAxis : undefined,
  };
}

export function getObjectViewState(context: Record<string, unknown> | undefined): ObjectViewState {
  if (!context) return {};
  const rawView = context.view;
  if (rawView && typeof rawView === 'object' && !Array.isArray(rawView)) {
    return normalizeViewState(rawView as Record<string, unknown>);
  }
  return {};
}

export function buildDefaultViewState(
  objectType: ObjectType,
  context: Record<string, unknown>,
  profile: DataProfile | null
): ObjectViewState {
  switch (objectType) {
    case 'inspector':
    case 'dataset': {
      const columns = Array.isArray(context.columns)
        ? context.columns.filter((value): value is string => typeof value === 'string')
        : [];
      const rows = Array.isArray(context.rows) ? context.rows : [];
      const preferredColumns = profile?.displayColumns?.filter((column) => columns.includes(column));
      return {
        limit: rows.length || undefined,
        sortBy: profile?.cardRecommendations?.inspector?.sortBy || profile?.primaryMeasureColumn || columns[1],
        sortDirection: profile?.sortDirection || 'desc',
        preferredColumns: preferredColumns && preferredColumns.length > 0 ? preferredColumns : undefined,
        displayMode: 'table',
      };
    }
    case 'alert': {
      const alerts = Array.isArray(context.alerts) ? context.alerts : [];
      return compactObject({
        limit: alerts.length || undefined,
      });
    }
    case 'comparison':
      return compactObject({
        sortBy: profile?.cardRecommendations?.comparison?.contrastColumn || profile?.groupByColumn,
      });
    default:
      return {};
  }
}

function summarizeTable(
  context: Record<string, unknown>,
  profile: DataProfile | null
): Record<string, unknown> {
  const columns = Array.isArray(context.columns)
    ? context.columns.filter((value): value is string => typeof value === 'string')
    : [];
  const rows = Array.isArray(context.rows)
    ? context.rows.filter((value): value is string[] => Array.isArray(value))
    : [];
  const view = getObjectViewState(context);
  const previewColumns = (view.preferredColumns && view.preferredColumns.length > 0
    ? view.preferredColumns
    : profile?.displayColumns?.filter((column) => columns.includes(column))) || columns.slice(0, 5);

  return compactObject({
    shape: 'table',
    rowCount: rows.length,
    columnCount: columns.length,
    columns: columns.slice(0, 8),
    visibleColumns: previewColumns.slice(0, 6),
    sampleRows: rows.slice(0, 3).map((row) =>
      Object.fromEntries(
        previewColumns.slice(0, 5).map((column) => {
          const columnIndex = columns.indexOf(column);
          return [column, truncate(columnIndex >= 0 ? row[columnIndex] : '')];
        })
      )
    ),
    view: compactObject({
      limit: view.limit,
      tierFilter: view.tierFilter,
      textSearch: view.textSearch,
      columnFilter: view.columnFilter,
      sortBy: view.sortBy,
      sortDirection: view.sortDirection,
      displayMode: view.displayMode,
      chartType: view.chartType,
    }),
  });
}

function summarizeAlerts(context: Record<string, unknown>): Record<string, unknown> {
  const alerts = Array.isArray(context.alerts)
    ? context.alerts.filter((alert): alert is Record<string, unknown> => Boolean(alert) && typeof alert === 'object')
    : [];

  const severityCounts = alerts.reduce<Record<string, number>>((counts, alert) => {
    const severity = typeof alert.severity === 'string' ? alert.severity : 'unknown';
    counts[severity] = (counts[severity] || 0) + 1;
    return counts;
  }, {});

  return compactObject({
    shape: 'alerts',
    alertCount: alerts.length,
    severities: severityCounts,
    topAlerts: alerts.slice(0, 3).map((alert) =>
      compactObject({
        title: truncate(alert.title, 60),
        severity: typeof alert.severity === 'string' ? alert.severity : undefined,
        actionable: alert.actionable === true ? true : undefined,
      })
    ),
    view: getObjectViewState(context),
  });
}

function summarizeMetric(context: Record<string, unknown>): Record<string, unknown> {
  const breakdown = Array.isArray(context.breakdown)
    ? context.breakdown.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
    : [];

  return compactObject({
    shape: 'metric',
    currentValue: context.currentValue,
    unit: context.unit,
    trend: context.trend,
    change: context.change,
    context: typeof context.context === 'string' ? truncate(context.context) : undefined,
    breakdown: breakdown.slice(0, 4).map((item) =>
      compactObject({
        name: typeof item.name === 'string' ? item.name : undefined,
        value: item.value,
      })
    ),
  });
}

function summarizeComparison(context: Record<string, unknown>): Record<string, unknown> {
  const entities = Array.isArray(context.entities)
    ? context.entities.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
    : [];
  const highlights = Array.isArray(context.highlights)
    ? context.highlights.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
    : [];

  return compactObject({
    shape: 'comparison',
    entityCount: entities.length,
    entities: entities.slice(0, 3).map((entity) =>
      compactObject({
        name: typeof entity.name === 'string' ? entity.name : undefined,
        metrics:
          entity.metrics && typeof entity.metrics === 'object'
            ? Object.fromEntries(Object.entries(entity.metrics as Record<string, unknown>).slice(0, 4))
            : undefined,
      })
    ),
    highlights: highlights.slice(0, 3).map((item) =>
      compactObject({
        insight: typeof item.insight === 'string' ? truncate(item.insight, 100) : undefined,
      })
    ),
    view: getObjectViewState(context),
  });
}

function summarizeBrief(context: Record<string, unknown>): Record<string, unknown> {
  const content = typeof context.content === 'string'
    ? context.content
    : typeof context.summary === 'string'
      ? context.summary
      : '';

  return compactObject({
    shape: 'brief',
    excerpt: truncate(content, 180),
    sourceObjectCount: Array.isArray(context.sourceObjects) ? context.sourceObjects.length : undefined,
    sourceCount: Array.isArray(context.sources) ? context.sources.length : undefined,
    insightCount: Array.isArray(context.insights) ? context.insights.length : undefined,
    view: getObjectViewState(context),
  });
}

function summarizeDocument(context: Record<string, unknown>): Record<string, unknown> {
  const content = typeof context.content === 'string' ? context.content : '';
  return compactObject({
    shape: 'document',
    fileName: typeof context.fileName === 'string' ? context.fileName : undefined,
    fileType: typeof context.fileType === 'string' ? context.fileType : undefined,
    pageCount: typeof context.pageCount === 'number' ? context.pageCount : undefined,
    excerpt: truncate(content, 180),
  });
}

function summarizeGenericContext(context: Record<string, unknown>): Record<string, unknown> {
  return compactObject({
    shape: 'generic',
    keys: Object.keys(context).slice(0, 10),
  });
}

export function buildObjectPromptSummary(
  object: WorkspaceObject,
  profile: DataProfile | null,
  focusedObjectId: string | null = null
): Record<string, unknown> {
  const common = compactObject({
    id: object.id,
    type: object.type,
    title: object.title,
    status: object.status,
    pinned: object.pinned ? true : undefined,
    isFocused: object.id === focusedObjectId ? true : undefined,
    relatedObjectIds: object.relationships.length > 0 ? object.relationships : undefined,
    sourceQuery: object.origin.query ? truncate(object.origin.query, 120) : undefined,
  });

  const context = object.context || {};

  if (Array.isArray(context.columns) && Array.isArray(context.rows)) {
    return { ...common, summary: summarizeTable(context, profile) };
  }
  if (Array.isArray(context.alerts)) {
    return { ...common, summary: summarizeAlerts(context) };
  }
  if (context.currentValue !== undefined) {
    return { ...common, summary: summarizeMetric(context) };
  }
  if (Array.isArray(context.entities)) {
    return { ...common, summary: summarizeComparison(context) };
  }
  if (typeof context.content === 'string' || typeof context.summary === 'string') {
    return { ...common, summary: summarizeBrief(context) };
  }
  if (context.fileName || context.fileType) {
    return { ...common, summary: summarizeDocument(context) };
  }

  return { ...common, summary: summarizeGenericContext(context) };
}

function buildRecentIntentSummaries(
  activeContext: ActiveContext | undefined,
  objects: Record<string, WorkspaceObject>
): Record<string, unknown>[] {
  const recent = activeContext?.recentIntents.slice(-6) || [];
  return recent.map((intent) => {
    const affectedTitles = (intent.affectedObjectIds || [])
      .map((id) => objects[id]?.title)
      .filter((value): value is string => Boolean(value));

    return compactObject({
      query: intent.query ? truncate(intent.query, 120) : undefined,
      response: intent.response ? truncate(intent.response, 160) : undefined,
      outcome: intent.outcomeSummary ? truncate(intent.outcomeSummary, 220) : undefined,
      focusedObjectId: intent.resultingFocusObjectId,
      affectedObjectTitles: affectedTitles.length > 0 ? affectedTitles : undefined,
      createdObjectIds: intent.createdObjectIds && intent.createdObjectIds.length > 0 ? intent.createdObjectIds : undefined,
    });
  });
}

export function buildWorkspaceIntentContext(options: {
  objects: Record<string, WorkspaceObject>;
  activeContext?: ActiveContext;
  profile: DataProfile | null;
}): string {
  const { objects, activeContext, profile } = options;
  const activeObjects = Object.values(objects)
    .filter((object) => object.status !== 'dissolved')
    .sort((a, b) => b.lastInteractedAt - a.lastInteractedAt);

  const payload = {
    datasetProfile: profile
      ? compactObject({
          domain: profile.domain,
          primaryEntity: profile.primaryIdColumn,
          primaryMeasure: profile.primaryMeasureColumn,
          measureFormat: profile.measureFormat,
          groupBy: profile.groupByColumn,
          displayColumns: profile.displayColumns,
          ordinalPriority: profile.ordinalPriorityColumn
            ? {
                column: profile.ordinalPriorityColumn.column,
                rankOrder: profile.ordinalPriorityColumn.rankOrder.slice(0, 6),
              }
            : undefined,
          urgencySignal: profile.urgencySignal,
          previewStrategy: profile.previewStrategy,
        })
      : null,
    activeContext: {
      focusedObjectId: activeContext?.focusedObjectId || null,
      focusedObjectTitle: activeContext?.focusedObjectId ? objects[activeContext.focusedObjectId]?.title || null : null,
      immersiveObjectId: activeContext?.immersiveObjectId || null,
      recentIntentOutcomes: buildRecentIntentSummaries(activeContext, objects),
    },
    workspace: {
      activeObjectCount: activeObjects.length,
      activeObjectTypes: [...new Set(activeObjects.map((object) => object.type))],
    },
    objects: activeObjects.map((object) => buildObjectPromptSummary(object, profile, activeContext?.focusedObjectId || null)),
  };

  return JSON.stringify(payload, null, 2);
}
