import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSuggestions } from '../sherpa-engine';
import { analyzeDataset, clearProfileCache } from '../data-analyzer';
import { setActiveDataset } from '../active-dataset';
import type { WorkspaceObject, ActiveContext } from '../workspace-types';

vi.mock('@/hooks/useAI', () => ({
  callAI: vi.fn().mockResolvedValue(null),
}));

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
      columns: ['Vendor', 'Tier', 'Balance', 'Region'],
      rows: [
        ['Acme', 'Tier 1', '$100', 'East'],
        ['Bravo', 'Tier 2', '$50', 'West'],
        ['Charlie', 'Tier 1', '$75', 'South'],
      ],
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
    setActiveDataset({
      columns: ['Vendor', 'Tier', 'Balance', 'Region'],
      rows: [
        ['Acme', 'Tier 1', '$100', 'East'],
        ['Bravo', 'Tier 2', '$50', 'West'],
        ['Charlie', 'Tier 1', '$75', 'South'],
      ],
      sourceDocId: null,
      sourceLabel: 'test-dataset',
    });
    await analyzeDataset(
      ['Vendor', 'Tier', 'Balance', 'Region'],
      [
        ['Acme', 'Tier 1', '$100', 'East'],
        ['Bravo', 'Tier 2', '$50', 'West'],
        ['Charlie', 'Tier 1', '$75', 'South'],
      ]
    );
  });

  it('prefers refinement suggestions for the focused object', () => {
    const suggestions = generateSuggestions({ 'inspector-1': makeObject() }, activeContext);
    expect(suggestions.some((suggestion) => suggestion.query.includes('only Tier 1'))).toBe(true);
    expect(suggestions.some((suggestion) => suggestion.query.includes('bar chart'))).toBe(true);
  });
});
