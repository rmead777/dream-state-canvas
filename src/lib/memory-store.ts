/**
 * Memory Store — CRUD operations for Sherpa's persistent memory.
 * All operations are non-blocking and degrade gracefully on failure.
 */
import { supabase } from '@/integrations/supabase/client';
import type { SherpaMemory, MemoryTrigger, MemoryType, MemorySource } from './memory-types';

// Use type assertion to work with the sherpa_memories table that isn't in generated types yet
const db = supabase as any;

// ─── Row ↔ Model Mapping ────────────────────────────────────────────────────

interface MemoryRow {
  id: string;
  user_id: string;
  type: string;
  trigger: Record<string, unknown>;
  content: string;
  reasoning: string | null;
  confidence: number;
  source: string;
  tier: string;
  hit_count: number;
  miss_count: number;
  last_activated_at: string | null;
  created_at: string;
  tags: string[];
}

function rowToMemory(row: MemoryRow): SherpaMemory {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as SherpaMemory['type'],
    trigger: row.trigger as MemoryTrigger,
    content: row.content,
    reasoning: row.reasoning ?? undefined,
    confidence: row.confidence,
    source: row.source as SherpaMemory['source'],
    tier: row.tier as SherpaMemory['tier'],
    hitCount: row.hit_count,
    missCount: row.miss_count,
    lastActivatedAt: row.last_activated_at,
    createdAt: row.created_at,
    tags: row.tags,
  };
}

// ─── CRUD Operations ─────────────────────────────────────────────────────────

export async function createMemory(params: {
  type: MemoryType;
  trigger: MemoryTrigger;
  content: string;
  reasoning?: string;
  confidence?: number;
  source?: MemorySource;
  tags?: string[];
}): Promise<SherpaMemory | null> {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;

  const confidence = params.confidence ?? 0.5;
  const { data, error } = await db
    .from('sherpa_memories')
    .upsert({
      user_id: user.id,
      type: params.type,
      trigger: params.trigger,
      content: params.content,
      reasoning: params.reasoning || null,
      confidence,
      source: params.source ?? 'inferred',
      tier: confidence >= 0.8 || params.source === 'confirmed' ? 'override' : 'prompt',
      tags: params.tags ?? [],
    }, {
      onConflict: 'user_id, type, content',
    })
    .select()
    .single();

  if (error) {
    console.warn('[memory-store] Failed to create memory:', error);
    return null;
  }
  return rowToMemory(data as unknown as MemoryRow);
}

export async function getMemories(userId: string): Promise<SherpaMemory[]> {
  const { data, error } = await db
    .from('sherpa_memories')
    .select('*')
    .eq('user_id', userId)
    .gt('confidence', 0.3)
    .order('confidence', { ascending: false });

  if (error) {
    console.warn('[memory-store] Failed to fetch memories:', error);
    return [];
  }
  return ((data || []) as unknown as MemoryRow[]).map(rowToMemory);
}

export async function getOverrideMemories(userId: string): Promise<SherpaMemory[]> {
  const { data, error } = await db
    .from('sherpa_memories')
    .select('*')
    .eq('user_id', userId)
    .eq('tier', 'override')
    .gte('confidence', 0.8)
    .order('confidence', { ascending: false });

  if (error) return [];
  return ((data || []) as unknown as MemoryRow[]).map(rowToMemory);
}

export async function getPendingMemories(userId: string): Promise<SherpaMemory[]> {
  const { data, error } = await db
    .from('sherpa_memories')
    .select('*')
    .eq('user_id', userId)
    .eq('source', 'inferred')
    .gte('confidence', 0.5)
    .lte('confidence', 0.75)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) return [];
  return ((data || []) as unknown as MemoryRow[]).map(rowToMemory);
}

export async function confirmMemory(id: string): Promise<void> {
  await db
    .from('sherpa_memories')
    .update({ source: 'confirmed', confidence: 1.0, tier: 'override' })
    .eq('id', id);
}

export async function deleteMemory(id: string): Promise<void> {
  await db
    .from('sherpa_memories')
    .delete()
    .eq('id', id);
}

export async function recordHit(id: string): Promise<void> {
  await db.rpc('increment_memory_hit', { memory_id: id });
}

export async function recordMiss(id: string): Promise<void> {
  await db.rpc('increment_memory_miss', { memory_id: id });
}

export async function decayStaleMemories(userId: string): Promise<void> {
  await db.rpc('decay_stale_memories', { target_user_id: userId });
}
