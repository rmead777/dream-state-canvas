import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleUpdate } from '../action-handlers';
import { analyzeDataset, clearProfileCache } from '../data-analyzer';
import { setActiveDataset } from '../active-dataset';
import type { WorkspaceObject } from '../workspace-types';
import { callAI } from '@/hooks/useAI';

vi.mock('@/hooks/useAI', () => ({
  callAI: vi.fn().mockResolvedValue(null),
}));

function makeInspector(overrides: Partial<WorkspaceObject> = {}): WorkspaceObject {
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

describe('handleUpdate', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
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

  it('can rename an inspector and persist chart-oriented view changes', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(JSON.stringify({
      response: 'Updated the inspector to focus on Tier 1 exposure by region.',
      renameTo: 'Tier 1 Exposure by Region',
      view: {
        tierFilter: 'Tier 1',
        limit: 2,
        preferredColumns: ['Vendor', 'Region', 'Balance'],
        displayMode: 'chart',
        chartType: 'bar',
        chartXAxis: 'Region',
        chartYAxis: 'Balance',
        sortBy: 'Balance',
        sortDirection: 'desc',
      },
    }));

    const result = await handleUpdate({
      target: makeInspector(),
      instruction: 'show only tier 1 as a bar chart by region and rename it',
      documentIds: [],
    });

    const updateDispatch = result.dispatches.find((dispatch) => dispatch.type === 'UPDATE_OBJECT');
    expect(updateDispatch).toBeTruthy();
    expect(updateDispatch?.payload.title).toBe('Tier 1 Exposure by Region');
    expect(updateDispatch?.payload.context.rows).toHaveLength(2);
    expect(updateDispatch?.payload.context.view.displayMode).toBe('chart');
    expect(updateDispatch?.payload.context.view.chartXAxis).toBe('Region');
    expect(updateDispatch?.payload.context.view.preferredColumns).toEqual(['Vendor', 'Region', 'Balance']);
  });
});
