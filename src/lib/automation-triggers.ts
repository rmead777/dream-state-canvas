/**
 * Automation Triggers — client-side trigger evaluation engine.
 *
 * Reads triggers from the `automation_triggers` Supabase table.
 * Evaluates each enabled trigger's condition against the active dataset.
 * Fires actions when conditions are met (after a cooldown to avoid spam).
 *
 * Action types:
 *   notify     → adds a Sherpa observation (ADD_SHERPA_OBSERVATION)
 *   create_card → materializes a new card on the canvas via a custom event
 */
import { supabase } from '@/integrations/supabase/client';
import { listDocuments, extractDataset } from './document-store';

// automation_triggers isn't in generated types yet (migration pending sync).
// Cast once here; remove when Lovable regenerates types.ts after the migration runs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * A single rule: column + operator + value(s).
 * Numeric operators: gt, lt, gte, lte, eq, neq, between (value is [min,max])
 * Text operators:    contains, not_contains, starts_with, ends_with, equals_text
 * Set operators:     in, not_in (value is array)
 * Null operators:    is_null, is_not_null (value ignored)
 */
export type TriggerOperator =
  | 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq' | 'between'
  | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'equals_text'
  | 'in' | 'not_in'
  | 'is_null' | 'is_not_null';

export interface TriggerRule {
  column: string;
  operator: TriggerOperator;
  value?: number | string | (number | string)[];
  /** Two values for 'between' — inclusive min/max */
  valueMax?: number | string;
}

/**
 * TriggerCondition supports BOTH legacy single-rule shape (backward compat)
 * AND new multi-rule shape with `rules[]` and `combinator` (AND/OR).
 * Multiple rules on the same column are allowed (e.g. delivery_date >= X AND <= Y).
 */
export interface TriggerCondition {
  /** Legacy fields — kept for backward compat with existing rows */
  column?: string;
  operator?: TriggerOperator;
  value?: number | string | (number | string)[];
  valueMax?: number | string;

  /** New: stack of rules combined with AND/OR. Same column may appear multiple times. */
  rules?: TriggerRule[];
  combinator?: 'AND' | 'OR';

  aggregation?: 'any' | 'count' | 'sum';
  /**
   * For `count` and `sum` aggregations: explicit threshold to compare the aggregate against.
   * If omitted, count defaults to `gt 0` (fire when at least one row matches).
   * For sum, omitting falls back to using the first rule's operator/value as the threshold.
   */
  aggregationOperator?: TriggerOperator;
  aggregationValue?: number;
  aggregationValueMax?: number;
}

export interface TriggerAction {
  type: 'notify' | 'create_card';
  params: Record<string, any>;
}

export interface AutomationTrigger {
  id: string;
  user_id: string;
  label: string;
  condition: TriggerCondition;
  action: TriggerAction;
  enabled: boolean;
  fire_count: number;
  last_fired_at: string | null;
  created_at: string;
}

export interface TriggerFiring {
  trigger: AutomationTrigger;
  observation: string;
  actionType: TriggerAction['type'];
  actionParams: Record<string, any>;
}

function parseNum(raw: unknown): number {
  return parseFloat(String(raw ?? '').replace(/[$,%\s]/g, ''));
}

/**
 * Convert an Excel/Sheets date serial to YYYY-MM-DD. Excel epoch is 1900-01-01,
 * UNIX epoch is 1970-01-01 → offset of 25569 days. Returns null if not a plausible serial.
 * Used so triggers comparing against ISO date values (e.g. "delivery date < 2026-05-01")
 * still work on Ragic exports where dates arrive as raw serials like 46135.
 */
function excelSerialToISO(value: string): string | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 20000 || num > 80000) return null; // ~1954–2118
  const ms = Math.round((num - 25569) * 86400 * 1000);
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** Evaluate a single rule against a single cell value. */
function evalRule(cell: unknown, rule: TriggerRule): boolean {
  const op = rule.operator;
  const cellStr = String(cell ?? '');
  const cellLower = cellStr.toLowerCase();

  if (op === 'is_null') return !cellStr || cellStr === '—' || cellStr === '-';
  if (op === 'is_not_null') return !!cellStr && cellStr !== '—' && cellStr !== '-';

  if (op === 'in' || op === 'not_in') {
    const arr = Array.isArray(rule.value) ? rule.value : [rule.value];
    const hit = arr.some(v => cellLower.includes(String(v ?? '').toLowerCase()));
    return op === 'in' ? hit : !hit;
  }

  const valStr = String(rule.value ?? '').toLowerCase();
  if (op === 'contains') return cellLower.includes(valStr);
  if (op === 'not_contains') return !cellLower.includes(valStr);
  if (op === 'starts_with') return cellLower.startsWith(valStr);
  if (op === 'ends_with') return cellLower.endsWith(valStr);
  if (op === 'equals_text') return cellLower === valStr;

  // Date comparisons: rule value drives the type. If rule value is ISO-shaped,
  // also accept Excel serial cells (e.g. 46135 from Ragic) by converting them.
  const ruleValStr = String(rule.value ?? '');
  const ruleValMaxStr = String(rule.valueMax ?? '');
  const ruleIsDate = ISO_DATE_RE.test(ruleValStr);
  const ruleMaxIsDate = ISO_DATE_RE.test(ruleValMaxStr);
  let effectiveCell = cellStr;
  if (ruleIsDate && !ISO_DATE_RE.test(cellStr)) {
    const converted = excelSerialToISO(cellStr);
    if (converted) effectiveCell = converted;
  }
  const isDate = ruleIsDate && ISO_DATE_RE.test(effectiveCell);

  if (op === 'between') {
    if (isDate && ruleMaxIsDate) {
      return effectiveCell >= ruleValStr && effectiveCell <= ruleValMaxStr;
    }
    const n = parseNum(cell);
    return !isNaN(n) && n >= Number(rule.value) && n <= Number(rule.valueMax);
  }
  if (isDate) {
    switch (op) {
      case 'gt':  return effectiveCell > ruleValStr;
      case 'lt':  return effectiveCell < ruleValStr;
      case 'gte': return effectiveCell >= ruleValStr;
      case 'lte': return effectiveCell <= ruleValStr;
      case 'eq':  return effectiveCell === ruleValStr;
      case 'neq': return effectiveCell !== ruleValStr;
    }
  }
  const n = parseNum(cell);
  if (isNaN(n)) return false;
  const v = Number(rule.value);
  switch (op) {
    case 'gt':  return n > v;
    case 'lt':  return n < v;
    case 'gte': return n >= v;
    case 'lte': return n <= v;
    case 'eq':  return Math.abs(n - v) < 0.0001;
    case 'neq': return Math.abs(n - v) >= 0.0001;
  }
  return false;
}

/** Normalize legacy single-rule conditions into a rules[] array. */
export function getRules(condition: TriggerCondition): TriggerRule[] {
  if (condition.rules?.length) return condition.rules;
  if (condition.column && condition.operator) {
    return [{
      column: condition.column,
      operator: condition.operator,
      value: condition.value,
      valueMax: condition.valueMax,
    }];
  }
  return [];
}

function evaluateTrigger(
  trigger: AutomationTrigger,
  columns: string[],
  rows: string[][],
): boolean {
  const rules = getRules(trigger.condition);
  if (!rules.length) return false;

  const ruleIndices = rules.map(r => ({
    rule: r,
    idx: columns.findIndex(c => c.toLowerCase() === r.column.toLowerCase()),
  }));
  if (ruleIndices.some(r => r.idx === -1)) return false;

  const combinator = trigger.condition.combinator ?? 'AND';
  const agg = trigger.condition.aggregation ?? 'any';

  const rowMatches = (row: string[]): boolean => {
    const results = ruleIndices.map(({ rule, idx }) => evalRule(row[idx], rule));
    return combinator === 'OR' ? results.some(Boolean) : results.every(Boolean);
  };

  // Sum aggregation: total the first rule's column over ALL rows, compare to threshold.
  // Threshold defaults to first rule's operator/value (legacy behavior) but can be overridden.
  if (agg === 'sum') {
    const first = ruleIndices[0];
    const total = rows.reduce((acc, row) => {
      const n = parseNum(row[first.idx]);
      return acc + (isNaN(n) ? 0 : n);
    }, 0);
    const aggOp = trigger.condition.aggregationOperator ?? first.rule.operator;
    const aggVal = trigger.condition.aggregationValue ?? Number(first.rule.value);
    const aggMax = trigger.condition.aggregationValueMax ?? (first.rule.valueMax !== undefined ? Number(first.rule.valueMax) : undefined);
    return evalRule(total, { column: '__sum__', operator: aggOp, value: aggVal, valueMax: aggMax });
  }

  const matchedCount = rows.filter(rowMatches).length;

  // Count aggregation: how many rows passed the rule(s)? Compare count to an explicit threshold.
  // Defaults to gt 0 — i.e., "fire if any row matched" — same as `any` aggregation when no threshold set.
  if (agg === 'count') {
    const aggOp = trigger.condition.aggregationOperator ?? 'gt';
    const aggVal = trigger.condition.aggregationValue ?? 0;
    const aggMax = trigger.condition.aggregationValueMax;
    return evalRule(matchedCount, { column: '__count__', operator: aggOp, value: aggVal, valueMax: aggMax });
  }

  return matchedCount > 0;
}

/**
 * Load only enabled triggers — used by the 30s scan loop.
 */
export async function loadTriggers(): Promise<AutomationTrigger[]> {
  const { data, error } = await db
    .from('automation_triggers')
    .select('*')
    .eq('enabled', true)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('[automation-triggers] Failed to load triggers:', error.message);
    return [];
  }
  return (data ?? []) as unknown as AutomationTrigger[];
}

/**
 * Load ALL triggers (enabled + disabled) — used by the AutomationPanel UI.
 */
export async function loadAllTriggers(): Promise<AutomationTrigger[]> {
  const { data, error } = await db
    .from('automation_triggers')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('[automation-triggers] Failed to load all triggers:', error.message);
    return [];
  }
  return (data ?? []) as unknown as AutomationTrigger[];
}

/**
 * Create a new automation trigger in Supabase.
 */
export async function createTrigger(params: {
  label: string;
  condition: TriggerCondition;
  action?: TriggerAction;
}): Promise<AutomationTrigger | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await db
    .from('automation_triggers')
    .insert({
      user_id: user.id,
      label: params.label,
      condition: params.condition,
      action: params.action ?? { type: 'notify', params: {} },
    })
    .select()
    .single();

  if (error) {
    console.error('[automation-triggers] Insert failed:', error.message);
    return null;
  }
  return data as unknown as AutomationTrigger;
}

/**
 * Delete a trigger by ID.
 */
export async function deleteTrigger(id: string): Promise<boolean> {
  const { error } = await db.from('automation_triggers').delete().eq('id', id);
  return !error;
}

/**
 * Toggle a trigger's enabled state.
 */
export async function toggleTrigger(id: string, enabled: boolean): Promise<boolean> {
  const { error } = await db.from('automation_triggers').update({ enabled }).eq('id', id);
  return !error;
}

/**
 * Update a trigger's label, condition, and/or action. Each field is optional —
 * pass only the fields you want to change. Used by Sherpa's `updateTrigger`
 * tool to refine triggers in-place (e.g., adding a Status=Open filter to an
 * existing master trigger).
 */
export async function updateTrigger(
  id: string,
  patch: { label?: string; condition?: TriggerCondition; action?: TriggerAction; enabled?: boolean },
): Promise<boolean> {
  const update: Record<string, unknown> = {};
  if (patch.label !== undefined) update.label = patch.label;
  if (patch.condition !== undefined) update.condition = patch.condition;
  if (patch.action !== undefined) update.action = patch.action;
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (Object.keys(update).length === 0) return true;
  const { error } = await db.from('automation_triggers').update(update).eq('id', id);
  if (error) {
    console.error('[automation-triggers] Update failed:', error.message);
    return false;
  }
  return true;
}

// Cooldown: only fire a given trigger once every N seconds to prevent spam
const COOLDOWN_MS = 300_000; // 5 minutes per trigger
const lastFiredLocal: Record<string, number> = {};

/**
 * A single dataset slice the trigger engine can evaluate against.
 * `source` is a free-form label (document name, "active", "scratchpad:Trigger Watch")
 * surfaced in the firing payload so consumers can know which dataset triggered.
 */
export interface DatasetSlice {
  columns: string[];
  rows: string[][];
  source?: string;
}

/**
 * Evaluate all loaded triggers against one or more dataset slices.
 *
 * For each trigger, we walk the slices in order and fire on the FIRST slice
 * whose columns satisfy the trigger's condition. This makes triggers "always-on"
 * across all loaded scratchpads/documents — they no longer require the matching
 * dataset to be the active one.
 *
 * Backward-compat: if called with `(triggers, columns, rows)` the legacy single-slice
 * path is used (typed via overload below).
 */
export function checkTriggers(triggers: AutomationTrigger[], slices: DatasetSlice[]): TriggerFiring[];
export function checkTriggers(triggers: AutomationTrigger[], dataColumns: string[], dataRows: string[][]): TriggerFiring[];
export function checkTriggers(
  triggers: AutomationTrigger[],
  slicesOrColumns: DatasetSlice[] | string[],
  maybeRows?: string[][],
): TriggerFiring[] {
  if (!triggers.length) return [];

  // Normalize into DatasetSlice[]
  const slices: DatasetSlice[] = Array.isArray(slicesOrColumns) && slicesOrColumns.length > 0 && typeof slicesOrColumns[0] === 'string'
    ? [{ columns: slicesOrColumns as string[], rows: maybeRows ?? [], source: 'active' }]
    : (slicesOrColumns as DatasetSlice[]);

  const usableSlices = slices.filter(s => s.rows.length > 0);
  if (!usableSlices.length) return [];

  const now = Date.now();
  const firings: TriggerFiring[] = [];

  for (const trigger of triggers) {
    // Respect client-side cooldown
    const lastFired = lastFiredLocal[trigger.id] ?? 0;
    if (now - lastFired < COOLDOWN_MS) continue;

    // Walk slices; fire on the first match.
    for (const slice of usableSlices) {
      if (!evaluateTrigger(trigger, slice.columns, slice.rows)) continue;
      lastFiredLocal[trigger.id] = now;
      firings.push({
        trigger,
        observation: `[Trigger] ${trigger.label} — condition met${slice.source ? ` (in ${slice.source})` : ''}`,
        actionType: trigger.action.type,
        actionParams: trigger.action.params ?? {},
      });
      break;
    }
  }

  return firings;
}

/**
 * Mark a trigger as fired in Supabase (fire_count++ and last_fired_at).
 * Fire-and-forget — failures are non-fatal.
 */
export async function markTriggerFired(triggerId: string): Promise<void> {
  // Atomic increment via server-side RPC — no read-modify-write race
  await db.rpc('increment_trigger_fire_count', { trigger_id: triggerId });
}
