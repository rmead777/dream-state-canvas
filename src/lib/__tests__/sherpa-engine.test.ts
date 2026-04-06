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
      view: {
        sortBy: 'Balance',
        sortDirection: 'desc',
      },
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

describe('generateSuggestions', () => {
  beforeEach(async () => {
    clearProfileCache();
    // No global singleton — pass data directly to generateSuggestions
    await analyzeDataset(TEST_COLUMNS, TEST_ROWS);
  });

  it('prefers refinement suggestions for the focused object', () => {
    // generateSuggestions now accepts data columns/rows as params
    const suggestions = generateSuggestions(
      { 'inspector-1': makeObject() },
      activeContext,
      TEST_COLUMNS,
      TEST_ROWS,
    );
    expect(suggestions.some((suggestion) => suggestion.query.includes('only Tier 1'))).toBe(true);
    expect(suggestions.some((suggestion) => suggestion.query.includes('bar chart'))).toBe(true);
  });
});
