import { callAI } from '@/hooks/useAI';

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
  const sig = columns.join('|') + '::' + rows.length + '::' +
    (rows[0]?.join('|') || '') + '::' + (rows[rows.length - 1]?.join('|') || '');
  return hashString(sig);
}

const CACHE_PREFIX = 'dataset-profile-';
let memoryCache: { fingerprint: string; profile: DataProfile } | null = null;

/**
 * Get cached profile from localStorage or memory.
 */
function getCachedProfile(fingerprint: string): DataProfile | null {
  if (memoryCache?.fingerprint === fingerprint) return memoryCache.profile;

  try {
    const stored = localStorage.getItem(CACHE_PREFIX + fingerprint);
    if (stored) {
      const profile = JSON.parse(stored) as DataProfile;
      memoryCache = { fingerprint, profile };
      return profile;
    }
  } catch { /* corrupt */ }
  return null;
}

function setCachedProfile(fingerprint: string, profile: DataProfile): void {
  memoryCache = { fingerprint, profile };
  try {
    localStorage.setItem(CACHE_PREFIX + fingerprint, JSON.stringify(profile));
  } catch { /* storage full */ }
}

/**
 * Deterministic fallback — inspects columns heuristically when AI is unavailable.
 */
function buildFallbackProfile(columns: string[], rows: string[][]): DataProfile {
  // Find first string-like column (ID), first numeric-looking column (measure)
  let idCol = columns[0];
  let measureCol = columns[0];
  let groupCol: string | undefined;
  let urgencyCol: string | undefined;

  for (const col of columns) {
    const lower = col.toLowerCase();
    // Detect measure columns
    if (/balance|amount|total|value|revenue|salary|score|price|cost/i.test(lower)) {
      measureCol = col;
    }
    // Detect grouping columns
    if (/tier|category|group|team|region|type|status|class|division/i.test(lower)) {
      groupCol = col;
    }
    // Detect urgency/priority columns
    if (/tier|priority|urgency|risk|status|alert/i.test(lower)) {
      urgencyCol = col;
    }
  }

  // Detect urgency hot values from the group/urgency column
  const hotValues: string[] = [];
  if (urgencyCol) {
    const colIdx = columns.indexOf(urgencyCol);
    const uniqueVals = [...new Set(rows.map(r => r[colIdx]).filter(Boolean))];
    // Pick values containing keywords like "act now", "urgent", "critical", "high"
    for (const v of uniqueVals) {
      if (/act now|urgent|critical|high|unblock|immediate/i.test(v)) {
        hotValues.push(v);
      }
    }
  }

  // Detect currency formatting
  const measureIdx = columns.indexOf(measureCol);
  const hasCurrency = rows.some(r => r[measureIdx]?.startsWith('$'));

  return {
    domain: 'general',
    primaryIdColumn: idCol,
    primaryMeasureColumn: measureCol,
    measureFormat: hasCurrency ? 'currency' : 'number',
    sortDirection: 'desc',
    groupByColumn: groupCol,
    urgencySignal: urgencyCol ? { column: urgencyCol, hotValues } : undefined,
    previewStrategy: `Top items by ${measureCol}, prioritizing urgent items`,
    cardRecommendations: {
      metric: { title: `Total ${measureCol}`, aggregateColumn: measureCol },
      alert: { filterColumn: urgencyCol || columns[0], filterValues: hotValues },
      inspector: { sortBy: measureCol, limit: 8 },
      comparison: { contrastColumn: groupCol || columns[0] },
    },
  };
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
  if (cached) return cached;

  // Try AI analysis
  try {
    const sampleRows = rows.slice(0, 30);
    const tablePreview = [columns.join(' | '), ...sampleRows.map(r => r.join(' | '))].join('\n');

    const result = await callAI(
      [{
        role: 'user',
        content: `Here is a dataset with ${rows.length} rows and ${columns.length} columns.\n\nColumns and sample rows:\n${tablePreview}\n\nAnalyze this dataset and return a JSON object with these fields:\n- "domain": string (what domain is this data about)\n- "primaryIdColumn": string (which column is the entity identifier)\n- "primaryMeasureColumn": string (the main numeric column to rank/sort by)\n- "measureFormat": "currency" | "number" | "percentage"\n- "sortDirection": "desc" | "asc"\n- "groupByColumn": string or null (categorical grouping column)\n- "urgencySignal": { "column": string, "hotValues": string[] } or null (which column+values indicate urgency)\n- "previewStrategy": string (describe in one sentence how to pick the most important rows for a compact preview)\n- "cardRecommendations": { "metric": { "title": string, "aggregateColumn": string }, "alert": { "filterColumn": string, "filterValues": string[] }, "inspector": { "sortBy": string, "limit": number }, "comparison": { "contrastColumn": string } }\n\nReturn ONLY the JSON object, no markdown.`,
      }],
      'analyze-schema'
    );

    if (result) {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const profile = JSON.parse(jsonMatch[0]) as DataProfile;
        setCachedProfile(fingerprint, profile);
        return profile;
      }
    }
  } catch {
    // Fall through to heuristic
  }

  // Fallback
  const fallback = buildFallbackProfile(columns, rows);
  setCachedProfile(fingerprint, fallback);
  return fallback;
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
        content: `Here is a dataset with ${rows.length} rows and ${columns.length} columns.\n\nColumns and sample rows:\n${tablePreview}\n\nThe CURRENT prioritization profile is:\n${JSON.stringify(currentProfile, null, 2)}\n\nThe user wants to change how data is prioritized. Their instruction:\n"${userFeedback}"\n\nUpdate the profile based on their feedback. Return the FULL updated JSON profile with the same schema — all fields must be present. Change only what the user requested. Return ONLY the JSON object, no markdown.`,
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
  } catch { /* ignore */ }
}
