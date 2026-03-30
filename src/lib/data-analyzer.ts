import { callAI } from '@/hooks/useAI';
import { SherpaMemory } from './memory-types';
import { getOverrideMemories } from './memory-store';
import { supabase } from '@/integrations/supabase/client';

/**
 * DataProfile — a domain-agnostic schema analysis result.
 * The AI inspects column names + sample rows and returns this structure,
 * which tells the data-slicer how to prioritize/derive preview subsets.
 */
export interface DataProfile {
  domain: string;                    // e.g. "accounts payable", "baseball stats"
  primaryIdColumn: string;           // entity name column
  primaryMeasureColumn: string;      // main numeric column to rank by
  measureFormat: 'currency' | 'number' | 'percentage';
  sortDirection: 'desc' | 'asc';
  groupByColumn?: string;            // categorical grouping (tier, team, region)

  /**
   * AI-selected display columns — the most important/digestible columns to show
   * by default in table views. Users can expand to see all columns.
   * Should be 4-7 columns that tell the most important story.
   */
  displayColumns?: string[];

  /**
   * Ordinal priority column — a column whose values represent an explicit
   * ranking hierarchy defined by the data itself (e.g. "Tier 1 — Act Now" > "Tier 2 — Unblock").
   * When present, rows are sorted by rankOrder FIRST, then by measure within each rank.
   * The AI must NEVER override this with numeric-value sorting unless the user explicitly asks.
   */
  ordinalPriorityColumn?: {
    column: string;
    rankOrder: string[];             // ordered from highest priority to lowest
  };

  urgencySignal?: {
    column: string;
    hotValues: string[];             // values meaning "needs attention"
  };
  previewStrategy: string;           // human-readable description
  cardRecommendations: {
    metric: { title: string; aggregateColumn: string };
    alert: { filterColumn: string; filterValues: string[] };
    inspector: { sortBy: string; limit: number };
    comparison: { contrastColumn: string };
  };
}

// Cache schema version — bump this to invalidate all old cached profiles
const CACHE_VERSION = 2;

// Simple string hash for fingerprinting
function hashString(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return 'dp-' + Math.abs(hash).toString(36);
}

function computeFingerprint(columns: string[], rows: string[][]): string {
  // Sample first, middle, and last rows + row count + columns to avoid collisions
  // when datasets differ only in middle rows (ME-013 fix)
  const mid = Math.floor(rows.length / 2);
  const sig = columns.join('|') + '::' + rows.length + '::' +
    (rows[0]?.join('|') || '') + '::' +
    (rows[mid]?.join('|') || '') + '::' +
    (rows[rows.length - 1]?.join('|') || '');
  return hashString(sig);
}

const CACHE_PREFIX = 'dataset-profile-';
let memoryCache: { fingerprint: string; profile: DataProfile } | null = null;

interface CachedEntry {
  version: number;
  profile: DataProfile;
}

/**
 * Get cached profile from localStorage or memory.
 * Invalidates entries from older schema versions.
 */
function getCachedProfile(fingerprint: string): DataProfile | null {
  if (memoryCache?.fingerprint === fingerprint) return memoryCache.profile;

  try {
    const stored = localStorage.getItem(CACHE_PREFIX + fingerprint);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Check version — old entries without version or with old version are discarded
      if (parsed && typeof parsed === 'object' && parsed.version === CACHE_VERSION) {
        const profile = parsed.profile as DataProfile;
        memoryCache = { fingerprint, profile };
        return profile;
      }
      // Stale cache — remove it
      localStorage.removeItem(CACHE_PREFIX + fingerprint);
    }
  } catch (e) { console.warn('[data-analyzer] Corrupt cached profile in localStorage:', e); }
  return null;
}

function setCachedProfile(fingerprint: string, profile: DataProfile): void {
  memoryCache = { fingerprint, profile };
  try {
    const entry: CachedEntry = { version: CACHE_VERSION, profile };
    localStorage.setItem(CACHE_PREFIX + fingerprint, JSON.stringify(entry));
  } catch (e) { console.warn('[data-analyzer] Failed to cache profile to localStorage:', e); }
}

/**
 * Detect ordinal priority columns heuristically.
 * Looks for columns with values like "Tier 1 — Act Now", "Priority: High", numbered ranks, etc.
 */
function detectOrdinalPriority(columns: string[], rows: string[][]): DataProfile['ordinalPriorityColumn'] | undefined {
  for (const col of columns) {
    const lower = col.toLowerCase();
    if (!/tier|priority|rank|level|severity|urgency|class/i.test(lower)) continue;

    const colIdx = columns.indexOf(col);
    const uniqueVals = [...new Set(rows.map(r => r[colIdx]).filter(Boolean))];
    if (uniqueVals.length < 2 || uniqueVals.length > 10) continue;

    // Check if values have embedded numbers (Tier 1, Tier 2, etc.)
    const numbered = uniqueVals.filter(v => /\d/.test(v));
    if (numbered.length >= 2) {
      // Sort by embedded number ascending (Tier 1 first = highest priority)
      const sorted = [...uniqueVals].sort((a, b) => {
        const na = parseInt(a.match(/\d+/)?.[0] || '99');
        const nb = parseInt(b.match(/\d+/)?.[0] || '99');
        return na - nb;
      });
      return { column: col, rankOrder: sorted };
    }

    // Check for priority keywords
    const priorityKeywords = ['critical', 'high', 'act now', 'urgent', 'immediate'];
    const hasKeywords = uniqueVals.some(v => priorityKeywords.some(kw => v.toLowerCase().includes(kw)));
    if (hasKeywords) {
      // Sort by urgency keywords first
      const sorted = [...uniqueVals].sort((a, b) => {
        const scoreA = priorityKeywords.findIndex(kw => a.toLowerCase().includes(kw));
        const scoreB = priorityKeywords.findIndex(kw => b.toLowerCase().includes(kw));
        return (scoreA === -1 ? 99 : scoreA) - (scoreB === -1 ? 99 : scoreB);
      });
      return { column: col, rankOrder: sorted };
    }
  }
  return undefined;
}

/**
 * Deterministic fallback — inspects columns heuristically when AI is unavailable.
 */
function buildFallbackProfile(columns: string[], rows: string[][]): DataProfile {
  let idCol = columns[0];
  let measureCol = columns[0];
  let groupCol: string | undefined;
  let urgencyCol: string | undefined;

  for (const col of columns) {
    const lower = col.toLowerCase();
    if (/balance|amount|total|value|revenue|salary|score|price|cost/i.test(lower)) {
      measureCol = col;
    }
    if (/tier|category|group|team|region|type|status|class|division/i.test(lower)) {
      groupCol = col;
    }
    if (/tier|priority|urgency|risk|status|alert/i.test(lower)) {
      urgencyCol = col;
    }
  }

  // Detect ordinal priority
  const ordinalPriority = detectOrdinalPriority(columns, rows);

  // Detect urgency hot values from the urgency column
  const hotValues: string[] = [];
  if (urgencyCol) {
    const colIdx = columns.indexOf(urgencyCol);
    const uniqueVals = [...new Set(rows.map(r => r[colIdx]).filter(Boolean))];
    for (const v of uniqueVals) {
      if (/act now|urgent|critical|high|unblock|immediate/i.test(v)) {
        hotValues.push(v);
      }
    }
  }

  // If we found an ordinal priority column, use it for urgency too
  if (ordinalPriority && !hotValues.length) {
    // Top-ranked values are "hot"
    const topHot = ordinalPriority.rankOrder.slice(0, 2);
    urgencyCol = ordinalPriority.column;
    hotValues.push(...topHot);
  }

  const measureIdx = columns.indexOf(measureCol);
  const hasCurrency = rows.some(r => r[measureIdx]?.startsWith('$'));

  // Build display columns — pick the most important ones heuristically
  const displayColumns = buildFallbackDisplayColumns(columns, idCol, measureCol, groupCol, urgencyCol);

  return {
    domain: 'general',
    primaryIdColumn: idCol,
    primaryMeasureColumn: measureCol,
    measureFormat: hasCurrency ? 'currency' : 'number',
    sortDirection: 'desc',
    groupByColumn: groupCol,
    displayColumns,
    ordinalPriorityColumn: ordinalPriority,
    urgencySignal: urgencyCol ? { column: urgencyCol, hotValues } : undefined,
    previewStrategy: ordinalPriority
      ? `Prioritize by ${ordinalPriority.column} rank order (${ordinalPriority.rankOrder[0]} first), then by ${measureCol} within each rank`
      : `Top items by ${measureCol}, prioritizing urgent items`,
    cardRecommendations: {
      metric: { title: `Total ${measureCol}`, aggregateColumn: measureCol },
      alert: { filterColumn: urgencyCol || columns[0], filterValues: hotValues },
      inspector: { sortBy: ordinalPriority ? ordinalPriority.column : measureCol, limit: 8 },
      comparison: { contrastColumn: groupCol || columns[0] },
    },
  };
}

/**
 * Pick 4-7 display columns heuristically for the fallback case.
 */
function buildFallbackDisplayColumns(
  columns: string[],
  idCol: string,
  measureCol: string,
  groupCol?: string,
  urgencyCol?: string
): string[] {
  const picked = new Set<string>();
  picked.add(idCol);
  if (groupCol) picked.add(groupCol);
  if (urgencyCol && urgencyCol !== groupCol) picked.add(urgencyCol);
  picked.add(measureCol);

  // Add a few more columns that seem high-signal, skip verbose ones
  for (const col of columns) {
    if (picked.size >= 7) break;
    if (picked.has(col)) continue;
    const lower = col.toLowerCase();
    // Skip verbose/low-signal columns
    if (/note|comment|detail|description|thread|reconcil|summary|narrative|history/i.test(lower)) continue;
    // Prefer short-label columns
    if (/contact|email|status|date|source|risk|type|category/i.test(lower)) {
      picked.add(col);
    }
  }

  // If still under 4, pad with remaining columns (skip verbose)
  for (const col of columns) {
    if (picked.size >= 5) break;
    if (picked.has(col)) continue;
    const lower = col.toLowerCase();
    if (/note|comment|detail|description|thread|reconcil|summary|narrative|history/i.test(lower)) continue;
    picked.add(col);
  }

  // Return in original column order
  return columns.filter(c => picked.has(c));
}

/**
 * Analyze a dataset — uses AI if available, caches result, falls back to heuristics.
 */
export async function analyzeDataset(
  columns: string[],
  rows: string[][]
): Promise<DataProfile> {
  const fingerprint = computeFingerprint(columns, rows);

  // Check cache first
  const cached = getCachedProfile(fingerprint);
  if (cached) return await applyTier2Overrides(cached);

  // Try AI analysis
  try {
    const sampleRows = rows.slice(0, 30);
    const tablePreview = [columns.join(' | '), ...sampleRows.map(r => r.join(' | '))].join('\n');

    const result = await callAI(
      [{
        role: 'user',
        content: `Here is a dataset with ${rows.length} rows and ${columns.length} columns.\n\nColumns and sample rows:\n${tablePreview}\n\nAnalyze this dataset and return a JSON object with these fields:\n- "domain": string (what domain is this data about)\n- "primaryIdColumn": string (which column is the entity identifier)\n- "primaryMeasureColumn": string (the main numeric column to rank/sort by)\n- "measureFormat": "currency" | "number" | "percentage"\n- "sortDirection": "desc" | "asc"\n- "groupByColumn": string or null (categorical grouping column)\n- "displayColumns": string[] — CRITICAL: Select 4-7 of the most important columns that tell the clearest story at a glance. Include the entity name, priority/tier, main measure, and 2-3 other high-signal columns. Exclude verbose text columns (long notes, reconciliation details, email threads) and columns that are mostly empty or redundant. The goal is a scannable, digestible table — not a data dump.\n- "ordinalPriorityColumn": { "column": string, "rankOrder": string[] } or null — CRITICAL: If any column represents an explicit priority/tier/rank hierarchy defined by the data (e.g. "Tier 1 — Act Now", "Priority: High"), you MUST identify it here. The rankOrder array must list values from HIGHEST priority to LOWEST. This column's rank order takes precedence over numeric sorting for previews.\n- "urgencySignal": { "column": string, "hotValues": string[] } or null (which column+values indicate urgency, hotValues ordered most to least urgent)\n- "previewStrategy": string (describe in one sentence how to pick the most important rows — if ordinalPriorityColumn exists, it must say rows are sorted by that column's rank first)\n- "cardRecommendations": { "metric": { "title": string, "aggregateColumn": string }, "alert": { "filterColumn": string, "filterValues": string[] }, "inspector": { "sortBy": string, "limit": number }, "comparison": { "contrastColumn": string } }\n\nReturn ONLY the JSON object, no markdown.`,
      }],
      'analyze-schema'
    );

    if (result) {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const profile = JSON.parse(jsonMatch[0]) as DataProfile;
        setCachedProfile(fingerprint, profile);
        return await applyTier2Overrides(profile);
      }
    }
  } catch {
    // Fall through to heuristic
  }

  // Fallback
  const fallback = buildFallbackProfile(columns, rows);
  setCachedProfile(fingerprint, fallback);
  return await applyTier2Overrides(fallback);
}

/**
 * Apply Tier 2 memory overrides to a DataProfile.
 * High-confidence memories directly modify the profile BEFORE the slicer runs.
 * This is deterministic — the AI never sees the un-overridden data.
 *
 * Override logic is MECHANICAL, not heuristic. Each override type makes a
 * specific, testable change to the profile. The AI can't ignore these because
 * they're applied before the AI runs.
 */
async function applyTier2Overrides(profile: DataProfile): Promise<DataProfile> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return profile;

    const overrides = await getOverrideMemories(user.id);
    if (overrides.length === 0) return profile;

    const result = { ...profile };
    const contentLower = (m: SherpaMemory) => m.content.toLowerCase();

    for (const m of overrides) {
      const cl = contentLower(m);

      // ── Ordinal priority lock ──────────────────────────────────────────
      // If user confirmed that tier/priority sorting should be respected,
      // ensure the ordinalPriorityColumn is never bypassed by numeric sorting.
      if (result.ordinalPriorityColumn && (
        m.tags.includes('sorting') ||
        m.tags.includes('tier') ||
        m.tags.includes('priority') ||
        /tier.*first|priority.*first|sort.*tier|sort.*priority|rank.*order/i.test(cl)
      )) {
        // Mechanical lock: ensure previewStrategy references ordinal priority
        if (!result.previewStrategy.includes(result.ordinalPriorityColumn.column)) {
          result.previewStrategy = `Sort by ${result.ordinalPriorityColumn.column} rank order (${result.ordinalPriorityColumn.rankOrder[0]} first), then by ${result.primaryMeasureColumn} within each rank`;
        }
      }

      // ── Sort direction override ────────────────────────────────────────
      if (m.type === 'preference' || m.type === 'correction') {
        if (/ascending|smallest.first|lowest.first|sort.*asc/i.test(cl)) {
          result.sortDirection = 'asc';
        } else if (/descending|largest.first|highest.first|sort.*desc/i.test(cl)) {
          result.sortDirection = 'desc';
        }
      }

      // ── Display column preferences ─────────────────────────────────────
      // Match actual column names from the profile against memory content.
      if ((m.type === 'preference' || m.type === 'correction') && result.displayColumns) {
        const allColumns = result.displayColumns;

        // "hide [column]" or "don't show [column]" → remove from display
        const hideMatch = cl.match(/(?:hide|remove|don't show|exclude)\s+(?:the\s+)?(.+?)(?:\s+column)?$/i);
        if (hideMatch) {
          const target = hideMatch[1].trim();
          const matched = allColumns.find(c => c.toLowerCase().includes(target));
          if (matched) {
            result.displayColumns = allColumns.filter(c => c !== matched);
          }
        }

        // "show [column]" or "add [column]" → add to display if it exists in dataset
        const showMatch = cl.match(/(?:show|add|include)\s+(?:the\s+)?(.+?)(?:\s+column)?$/i);
        if (showMatch) {
          const target = showMatch[1].trim();
          // We don't have all dataset columns here, but we can at least
          // check if it's already in displayColumns and add it if not
          const alreadyShown = allColumns.some(c => c.toLowerCase().includes(target));
          if (!alreadyShown) {
            // Can't validate against actual columns here, but the slicer
            // will gracefully ignore columns that don't exist in the dataset
            result.displayColumns = [...allColumns, showMatch[1].trim()];
          }
        }
      }

      // ── Primary measure override ───────────────────────────────────────
      // "sort by [column]" or "rank by [column]" → change primary measure
      if (m.type === 'preference' || m.type === 'correction') {
        const sortByMatch = cl.match(/(?:sort|rank|order|prioritize)\s+(?:by\s+)?(.+?)$/i);
        if (sortByMatch && !(/tier|priority|rank|asc|desc/i.test(sortByMatch[1]))) {
          // Only apply if it looks like a column name, not a direction/tier keyword
          const candidate = sortByMatch[1].trim();
          if (candidate.length > 2 && candidate.length < 50) {
            result.primaryMeasureColumn = candidate;
            result.cardRecommendations = {
              ...result.cardRecommendations,
              inspector: { ...result.cardRecommendations.inspector, sortBy: candidate },
              metric: { ...result.cardRecommendations.metric, aggregateColumn: candidate },
            };
          }
        }
      }
    }

    return result;
  } catch (e) {
    console.warn('[data-analyzer] Failed to apply Tier 2 overrides, continuing without:', e);
    return profile;
  }
}

/**
 * Refine an existing profile based on user feedback.
 * Sends the current profile + user instruction to AI, returns updated profile.
 */
export async function refineProfile(
  columns: string[],
  rows: string[][],
  currentProfile: DataProfile,
  userFeedback: string
): Promise<DataProfile> {
  const fingerprint = computeFingerprint(columns, rows);

  try {
    const sampleRows = rows.slice(0, 15);
    const tablePreview = [columns.join(' | '), ...sampleRows.map(r => r.join(' | '))].join('\n');

    const result = await callAI(
      [{
        role: 'user',
        content: `Here is a dataset with ${rows.length} rows and ${columns.length} columns.\n\nColumns and sample rows:\n${tablePreview}\n\nThe CURRENT prioritization profile is:\n${JSON.stringify(currentProfile, null, 2)}\n\nThe user wants to change how data is prioritized. Their instruction:\n"${userFeedback}"\n\nIMPORTANT RULES:\n1. If the profile has an ordinalPriorityColumn, do NOT remove it unless the user explicitly asks to ignore priorities/tiers.\n2. The ordinalPriorityColumn.rankOrder defines the sorting hierarchy — do NOT override it with numeric sorting unless asked.\n3. Only change what the user requested. Keep all other fields as they were.\n4. Return the FULL updated JSON profile with the same schema — all fields must be present.\n\nReturn ONLY the JSON object, no markdown.`,
      }],
      'refine-profile'
    );

    if (result) {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const updated = JSON.parse(jsonMatch[0]) as DataProfile;
        setCachedProfile(fingerprint, updated);
        return updated;
      }
    }
  } catch {
    // Return current profile unchanged on error
  }

  return currentProfile;
}

/**
 * Get the current cached profile for a dataset (if available).
 */
export function getCurrentProfile(columns: string[], rows: string[][]): DataProfile | null {
  const fingerprint = computeFingerprint(columns, rows);
  return getCachedProfile(fingerprint);
}

/**
 * Clear all cached profiles (e.g. when user uploads new data).
 */
export function clearProfileCache(): void {
  memoryCache = null;
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
    keys.forEach(k => localStorage.removeItem(k));
  } catch (e) { console.warn('[data-analyzer] Failed to cache refined profile:', e); }
}
