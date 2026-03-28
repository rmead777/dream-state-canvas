import { WorkspaceObject, Suggestion } from './workspace-types';
import { getActiveDataset } from './active-dataset';
import { getCurrentProfile, DataProfile } from './data-analyzer';
import { detectCrossTierAnomalies, describeRankingLogic } from './data-slicer';

/**
 * System-level Sherpa intelligence — observes workspace state
 * and generates proactive suggestions and observations.
 * Suggestions are derived from the active DataProfile so they
 * adapt to whatever dataset is loaded (AP vendors, baseball stats, etc).
 */

/**
 * Build domain-aware default suggestions from the DataProfile.
 */
function buildDefaultSuggestions(profile: DataProfile | null): Suggestion[] {
  if (!profile) {
    // Truly generic fallback when no profile exists yet
    return [
      { id: 's1', label: 'Show key metrics', query: 'show me the main metrics', priority: 1 },
      { id: 's2', label: 'What needs attention?', query: 'what needs immediate attention?', priority: 2 },
      { id: 's3', label: 'Explore the dataset', query: 'show the full dataset', priority: 3 },
    ];
  }

  const suggestions: Suggestion[] = [];
  const domain = profile.domain || 'data';
  const measure = profile.primaryMeasureColumn || 'value';
  const id = profile.primaryIdColumn || 'items';

  // 1. Total exposure / aggregate metric
  const metricLabel = profile.measureFormat === 'currency'
    ? `Show total ${measure.toLowerCase()}`
    : `Show ${measure.toLowerCase()} overview`;
  suggestions.push({
    id: 's1',
    label: metricLabel,
    query: `show me total ${measure.toLowerCase()} exposure`,
    priority: 1,
  });

  // 2. Urgency / action items
  if (profile.ordinalPriorityColumn) {
    const topTier = profile.ordinalPriorityColumn.rankOrder[0];
    const tierShort = topTier.replace(/^Tier \d+\s*—?\s*/, '');
    suggestions.push({
      id: 's2',
      label: `${tierShort} items`,
      query: `show me all ${topTier} items that need immediate action`,
      priority: 2,
    });
  } else if (profile.urgencySignal) {
    suggestions.push({
      id: 's2',
      label: 'What needs action?',
      query: `what ${id.toLowerCase()} need immediate action?`,
      priority: 2,
    });
  } else {
    suggestions.push({
      id: 's2',
      label: 'What stands out?',
      query: `what are the most notable ${id.toLowerCase()} in this dataset?`,
      priority: 2,
    });
  }

  // 3. Full dataset
  suggestions.push({
    id: 's3',
    label: `Explore full ${id.toLowerCase()} data`,
    query: `show the full ${id.toLowerCase()} dataset`,
    priority: 3,
  });

  return suggestions;
}

/**
 * Build contextual suggestions based on what's already on the canvas.
 */
function buildContextualSuggestions(
  objects: Record<string, WorkspaceObject>,
  profile: DataProfile | null
): Suggestion[] {
  const openObjects = Object.values(objects).filter(
    (o) => o.status === 'open' || o.status === 'materializing'
  );

  const suggestions: Suggestion[] = [];
  const hasMetric = openObjects.some((o) => o.type === 'metric');
  const hasComparison = openObjects.some((o) => o.type === 'comparison');
  const hasAlert = openObjects.some((o) => o.type === 'alert');
  const hasDocument = openObjects.some((o) => o.type === 'document');
  const hasDataset = openObjects.some((o) => o.type === 'dataset');
  const hasBrief = openObjects.some((o) => o.type === 'brief');

  const id = profile?.primaryIdColumn?.toLowerCase() || 'items';
  const measure = profile?.primaryMeasureColumn?.toLowerCase() || 'value';
  const group = profile?.groupByColumn;

  if (hasMetric && !hasComparison) {
    // Suggest comparison using actual entity names if possible
    const compareLabel = group
      ? `Compare by ${group.toLowerCase()}`
      : `Compare top ${id}`;
    suggestions.push({
      id: 'sg-compare',
      label: compareLabel,
      query: `compare the top two ${id} side by side`,
      priority: 1,
    });
  }

  if (!hasAlert) {
    if (profile?.ordinalPriorityColumn) {
      const topTier = profile.ordinalPriorityColumn.rankOrder[0];
      const tierShort = topTier.replace(/^Tier \d+\s*—?\s*/, '');
      suggestions.push({
        id: 'sg-focus',
        label: `Show ${tierShort} alerts`,
        query: `what ${id} need immediate action?`,
        priority: 2,
      });
    } else {
      suggestions.push({
        id: 'sg-focus',
        label: 'What needs attention?',
        query: `what should I focus on?`,
        priority: 2,
      });
    }
  }

  if (!hasDocument) {
    suggestions.push({
      id: 'sg-document',
      label: 'Open source document',
      query: 'open the source document',
      priority: 3,
    });
  }

  if (!hasDataset) {
    suggestions.push({
      id: 'sg-dataset',
      label: `Browse all ${id}`,
      query: `show the full ${id} dataset`,
      priority: 4,
    });
  }

  if (!hasBrief) {
    suggestions.push({
      id: 'sg-brief',
      label: `Generate ${profile?.domain || 'risk'} brief`,
      query: `give me a summary analysis of the ${profile?.domain || 'data'}`,
      priority: 5,
    });
  }

  return suggestions;
}

export function generateSuggestions(
  objects: Record<string, WorkspaceObject>
): Suggestion[] {
  const ds = getActiveDataset();
  const profile = getCurrentProfile(ds.columns, ds.rows);

  const openObjects = Object.values(objects).filter(
    (o) => o.status === 'open' || o.status === 'materializing'
  );

  if (openObjects.length === 0) {
    return buildDefaultSuggestions(profile);
  }

  const contextual = buildContextualSuggestions(objects, profile);
  return contextual.length > 0 ? contextual.slice(0, 3) : buildDefaultSuggestions(profile);
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

  // Cross-tier anomaly detection — surface in observations, NEVER re-rank
  const ds2 = getActiveDataset();
  const profile = getCurrentProfile(ds2.columns, ds2.rows);
  if (profile) {
    const anomalies = detectCrossTierAnomalies(
      ds2.columns,
      ds2.rows,
      profile
    );
    observations.push(...anomalies);

    // If no priority structure, inform the user about the provisional ranking
    if (!profile.ordinalPriorityColumn) {
      const desc = describeRankingLogic(profile);
      observations.push(desc);
    }
  }

  return observations;
}
