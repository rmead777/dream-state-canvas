/**
 * Intent Engine — DataProfile management and data rule refinement.
 *
 * NOTE: Intent parsing has been consolidated into the Sherpa Agent loop
 * (sherpa-agent.ts). This module retains only the DataProfile cache and
 * rule-refinement logic, which are consumed by action-handlers, document
 * upload flows, and the rules editor.
 *
 * The old parseIntentAI / parseIntent functions were removed because:
 * 1. processIntent() in useWorkspaceActions calls agentLoop() directly
 * 2. The agent loop builds its own context and uses tool calling
 * 3. Keyword fallback violated the AI-first principle (CLAUDE.md)
 */
import { analyzeDataset, refineProfile, DataProfile } from './data-analyzer';
import { listDocuments, extractDataset } from './document-store';

// Cached profile promise (runs once, invalidated on refinement)
let profilePromise: Promise<DataProfile> | null = null;

/** Resolve the first non-scratchpad spreadsheet for profile analysis. */
async function getFirstDataset(): Promise<{ columns: string[]; rows: string[][] }> {
  const docs = await listDocuments();
  const doc = docs.find(d => (d.file_type === 'xlsx' || d.file_type === 'csv') && d.structured_data && !(d.metadata as any)?.isScratchpad);
  const ds = doc ? extractDataset(doc) : null;
  return { columns: ds?.columns || [], rows: ds?.rows || [] };
}

function getProfile(): Promise<DataProfile> {
  if (!profilePromise) {
    profilePromise = getFirstDataset().then(ds => analyzeDataset(ds.columns, ds.rows));
  }
  return profilePromise;
}

/** Invalidate cached profile so next getProfile() re-fetches from cache/AI. */
export function invalidateProfileCache(): void {
  profilePromise = null;
}

/**
 * Refine data prioritization rules based on user feedback.
 * Returns the updated profile and invalidates the cached promise.
 */
export async function refineDataRules(userFeedback: string): Promise<DataProfile> {
  const current = await getProfile();
  const ds = await getFirstDataset();
  const updated = await refineProfile(
    ds.columns,
    ds.rows,
    current,
    userFeedback
  );
  // Replace the cached promise with the updated profile
  profilePromise = Promise.resolve(updated);
  return updated;
}
