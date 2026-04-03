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
import { getActiveDataset } from './active-dataset';

// automation_triggers isn't in generated types yet (migration pending sync).
// Cast once here; remove when Lovable regenerates types.ts after the migration runs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface TriggerCondition {
  column: string;
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq';
  value: number;
  aggregation?: 'any' | 'count' | 'sum';
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

function compareOp(num: number, op: TriggerCondition['operator'], value: number): boolean {
  switch (op) {
    case 'gt':  return num > value;
    case 'lt':  return num < value;
    case 'gte': return num >= value;
    case 'lte': return num <= value;
    case 'eq':  return Math.abs(num - value) < 0.0001;
    case 'neq': return Math.abs(num - value) >= 0.0001;
    default:    return false;
  }
}

function evaluateTrigger(
  trigger: AutomationTrigger,
  columns: string[],
  rows: string[][],
): boolean {
  const { condition } = trigger;
  const colIdx = columns.findIndex(c => c.toLowerCase() === condition.column.toLowerCase());
  if (colIdx === -1) return false;

  const parseNum = (raw: unknown) => parseFloat(String(raw ?? '').replace(/[$,%\s]/g, ''));
  const agg = condition.aggregation ?? 'any';

  if (agg === 'sum') {
    const total = rows.reduce((acc, row) => {
      const n = parseNum(row[colIdx]);
      return acc + (isNaN(n) ? 0 : n);
    }, 0);
    return compareOp(total, condition.operator, condition.value);
  }

  const matched = rows.filter(row => {
    const n = parseNum(row[colIdx]);
    return !isNaN(n) && compareOp(n, condition.operator, condition.value);
  });

  if (agg === 'count') {
    return compareOp(matched.length, condition.operator, condition.value);
  }

  return matched.length > 0;
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

// Cooldown: only fire a given trigger once every N seconds to prevent spam
const COOLDOWN_MS = 300_000; // 5 minutes per trigger
const lastFiredLocal: Record<string, number> = {};

/**
 * Evaluate all loaded triggers against the current dataset.
 * Returns firings — caller decides how to dispatch observations/cards.
 */
export function checkTriggers(triggers: AutomationTrigger[]): TriggerFiring[] {
  if (!triggers.length) return [];

  const { columns, rows } = getActiveDataset();
  if (!rows.length) return [];

  const now = Date.now();
  const firings: TriggerFiring[] = [];

  for (const trigger of triggers) {
    // Respect client-side cooldown
    const lastFired = lastFiredLocal[trigger.id] ?? 0;
    if (now - lastFired < COOLDOWN_MS) continue;

    if (!evaluateTrigger(trigger, columns, rows)) continue;

    lastFiredLocal[trigger.id] = now;
    firings.push({
      trigger,
      observation: `[Trigger] ${trigger.label} — condition met`,
      actionType: trigger.action.type,
      actionParams: trigger.action.params ?? {},
    });
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
