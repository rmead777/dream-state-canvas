import { describe, expect, it } from 'vitest';
import { buildWorkspaceIntentContext } from '../workspace-intelligence';
import type { DataProfile } from '../data-analyzer';
import type { WorkspaceObject, ActiveContext } from '../workspace-types';

function makeObject(overrides: Partial<WorkspaceObject> = {}): WorkspaceObject {
  return {
    id: 'inspector-1',
    type: 'inspector',
    title: 'Top Vendors',
    status: 'open',
    pinned: false,
    origin: { type: 'user-query', query: 'show vendors' },
    relationships: [],
    context: {
      columns: ['Vendor', 'Tier', 'Balance'],
      rows: [
        ['Acme', 'Tier 1', '$100'],
        ['Bravo', 'Tier 2', '$50'],
      ],
      view: {
        tierFilter: 'Tier 1',
        limit: 5,
        sortBy: 'Balance',
        sortDirection: 'desc',
      },
    },
    position: { zone: 'primary', order: 0 },
    createdAt: 1,
    lastInteractedAt: 2,
    ...overrides,
  };
}

const profile: DataProfile = {
  domain: 'accounts payable',
  primaryIdColumn: 'Vendor',
  primaryMeasureColumn: 'Balance',
  measureFormat: 'currency',
  sortDirection: 'desc',
  groupByColumn: 'Tier',
  displayColumns: ['Vendor', 'Tier', 'Balance'],
  ordinalPriorityColumn: {
    column: 'Tier',
    rankOrder: ['Tier 1', 'Tier 2'],
  },
  urgencySignal: {
    column: 'Tier',
    hotValues: ['Tier 1'],
  },
  previewStrategy: 'Sort by tier then balance',
  cardRecommendations: {
    metric: { title: 'Total Balance', aggregateColumn: 'Balance' },
    alert: { filterColumn: 'Tier', filterValues: ['Tier 1'] },
    inspector: { sortBy: 'Balance', limit: 8 },
    comparison: { contrastColumn: 'Tier' },
  },
};

describe('buildWorkspaceIntentContext', () => {
  it('includes focused object, recent outcomes, and object summaries', () => {
    const object = makeObject();
    const activeContext: ActiveContext = {
      focusedObjectId: object.id,
      immersiveObjectId: null,
      sessionStartedAt: 0,
      highlightedEntity: null,
      recentIntents: [
        {
          type: 'user-query',
          intentId: 'intent-1',
          query: 'show vendors',
          response: 'Showing top vendors.',
          outcomeSummary: 'Created inspector "Top Vendors" and focused it.',
          resultingFocusObjectId: object.id,
          affectedObjectIds: [object.id],
          createdObjectIds: [object.id],
        },
      ],
    };

    const payload = JSON.parse(
      buildWorkspaceIntentContext({
        objects: { [object.id]: object },
        activeContext,
        profile,
      })
    );

    expect(payload.activeContext.focusedObjectId).toBe(object.id);
    expect(payload.activeContext.recentIntentOutcomes[0].outcome).toContain('Created inspector');
    expect(payload.objects[0].summary.rowCount).toBe(2);
    expect(payload.objects[0].summary.view.tierFilter).toBe('Tier 1');
  });
});
