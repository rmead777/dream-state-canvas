import { WorkspaceObject, Suggestion } from './workspace-types';
import { DEFAULT_SUGGESTIONS } from './seed-data';

/**
 * System-level Sherpa intelligence — observes workspace state
 * and generates proactive suggestions and observations.
 * Pure functions, no React dependency.
 */

export function generateSuggestions(
  objects: Record<string, WorkspaceObject>
): Suggestion[] {
  const openObjects = Object.values(objects).filter(
    (o) => o.status === 'open' || o.status === 'materializing'
  );

  if (openObjects.length === 0) {
    return DEFAULT_SUGGESTIONS;
  }

  const suggestions: Suggestion[] = [];
  const hasMetric = openObjects.some((o) => o.type === 'metric');
  const hasComparison = openObjects.some((o) => o.type === 'comparison');
  const hasAlert = openObjects.some((o) => o.type === 'alert');
  const hasDocument = openObjects.some((o) => o.type === 'document');
  const hasDataset = openObjects.some((o) => o.type === 'dataset');

  if (hasMetric && !hasComparison) {
    suggestions.push({
      id: 'sg-compare',
      label: 'Compare funds',
      query: 'compare Alpha and Gamma',
      priority: 1,
    });
  }

  if (!hasAlert) {
    suggestions.push({
      id: 'sg-focus',
      label: 'What needs attention?',
      query: 'what should I focus on?',
      priority: 2,
    });
  }

  if (!hasDocument) {
    suggestions.push({
      id: 'sg-document',
      label: 'Open Q3 risk assessment',
      query: 'open the risk assessment document',
      priority: 3,
    });
  }

  if (!hasDataset) {
    suggestions.push({
      id: 'sg-dataset',
      label: 'Explore full dataset',
      query: 'show the full dataset',
      priority: 4,
    });
  }

  if (!openObjects.some((o) => o.type === 'brief')) {
    suggestions.push({
      id: 'sg-brief',
      label: 'Generate risk brief',
      query: 'give me a summary',
      priority: 5,
    });
  }

  return suggestions.length > 0 ? suggestions.slice(0, 3) : DEFAULT_SUGGESTIONS;
}

export function generateObservations(
  objects: Record<string, WorkspaceObject>
): string[] {
  const observations: string[] = [];
  const objectList = Object.values(objects);

  // Check for repeated interactions
  const frequentObjects = objectList.filter(
    (o) => o.status !== 'dissolved' && o.lastInteractedAt - o.createdAt > 60000
  );
  for (const obj of frequentObjects) {
    if (!obj.pinned) {
      observations.push(`You've been working with "${obj.title}" frequently. Want me to pin it?`);
    }
  }

  // Check for stale objects
  const now = Date.now();
  const stale = objectList.filter(
    (o) => o.status === 'open' && !o.pinned && now - o.lastInteractedAt > 300000
  );
  if (stale.length > 0) {
    observations.push(
      `${stale.length} workspace ${stale.length === 1 ? 'object hasn\'t' : 'objects haven\'t'} been touched recently. Shall I collapse ${stale.length === 1 ? 'it' : 'them'}?`
    );
  }

  return observations;
}
