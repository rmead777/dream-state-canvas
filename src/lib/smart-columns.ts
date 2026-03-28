/**
 * Smart column selection — filters columns to the AI-selected display set
 * and provides utilities for expand/collapse toggle.
 */
import { DataProfile, getCurrentProfile } from './data-analyzer';

/**
 * Get the display columns for a dataset. Uses the AI-selected displayColumns
 * from the DataProfile if available, otherwise returns a sensible default.
 */
export function getDisplayColumns(allColumns: string[], rows?: string[][]): string[] {
  if (allColumns.length <= 7) return allColumns;

  // Try to get the cached profile
  if (rows) {
    const profile = getCurrentProfile(allColumns, rows);
    if (profile?.displayColumns?.length) {
      // Ensure all display columns actually exist in the dataset
      const valid = profile.displayColumns.filter(c => allColumns.includes(c));
      if (valid.length >= 3) return valid;
    }
  }

  // Fallback: first 6 columns (entity + a few key fields)
  return allColumns.slice(0, 6);
}

/**
 * Filter a row to only include values at the display column indices.
 */
export function filterRowToColumns(
  row: string[],
  allColumns: string[],
  displayColumns: string[]
): string[] {
  return displayColumns.map(col => {
    const idx = allColumns.indexOf(col);
    return idx >= 0 ? row[idx] : '';
  });
}
