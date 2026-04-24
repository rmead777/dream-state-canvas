import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSuggestions } from '../sherpa-engine';
import { analyzeDataset, clearProfileCache } from '../data-analyzer';
import type { WorkspaceObject, ActiveContext } from '../workspace-types';

vi.mock('@/hooks/useAI', () => ({
  callAI: vi.fn().mockResolvedValue(null),
}));

const TEST_COLUMNS = ['Vendor', 'Tier', 'Balance', 'Region'];
const TEST_ROWS = [
  ['Acme', 'Tier 1', '$100', 'East'],
  ['Bravo', 'Tier 2', '$50', 'West'],
  ['Charlie', 'Tier 1', '$75', 'South'],
];

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
      columns: TEST_COLUMNS,
      rows: TEST_ROWS,
    },
    position: { zone: 'primary', order: 0 },
    createdAt: 1,
    lastInteractedAt: 10,
    ...overrides,
  };
}

const activeContext: ActiveContext = {
  focusedObjectId: 'inspector-1',
  immersiveObjectId: null,
  recentIntents: [],
  sessionStartedAt: 0,
  highlightedEntity: null,
};

describe('generateSuggestions (catalog-ranked)', () => {
  beforeEach(async () => {
    clearProfileCache();
    await analyzeDataset(TEST_COLUMNS, TEST_ROWS);
  });

  it('returns a non-empty ranked list with all connections available', () => {
    const suggestions = generateSuggestions(
      { 'inspector-1': makeObject() },
      activeContext,
      TEST_COLUMNS,
      TEST_ROWS,
      { limit: 5 },
    );
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(5);
    // Every entry has the shape the UI expects
    for (const s of suggestions) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.label).toBe('string');
      expect(typeof s.query).toBe('string');
      expect(typeof s.priority).toBe('number');
    }
  });

  it('hides entries that require missing integrations', () => {
    const withoutQb = generateSuggestions(
      { 'inspector-1': makeObject() },
      activeContext,
      TEST_COLUMNS,
      TEST_ROWS,
      { limit: 25, connections: { qb: false, ragic: true, email: true, documents: true } },
    );
    // No entry whose query requires live QB should appear
    expect(withoutQb.every((s) => !/QuickBooks/i.test(s.query))).toBe(true);
  });

  it('anchors favorited entries at the top', () => {
    const suggestions = generateSuggestions(
      { 'inspector-1': makeObject() },
      activeContext,
      TEST_COLUMNS,
      TEST_ROWS,
      { limit: 5, favoriteIds: ['cash-flow-signals'] },
    );
    expect(suggestions[0].id).toBe('cash-flow-signals');
  });
});
