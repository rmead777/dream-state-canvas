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
import { getActiveDataset } from './active-dataset';
import { analyzeDataset, refineProfile, DataProfile } from './data-analyzer';

// Cached profile promise (runs once, invalidated on refinement)
let profilePromise: Promise<DataProfile> | null = null;

function getProfile(): Promise<DataProfile> {
  if (!profilePromise) {
    const ds = getActiveDataset();
    profilePromise = analyzeDataset(ds.columns, ds.rows);
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
  const ds = getActiveDataset();
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
