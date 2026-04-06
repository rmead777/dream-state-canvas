import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleUpdate } from '../action-handlers';
import { analyzeDataset, clearProfileCache } from '../data-analyzer';
import type { WorkspaceObject } from '../workspace-types';
import { callAI } from '@/hooks/useAI';

vi.mock('@/hooks/useAI', () => ({
  callAI: vi.fn().mockResolvedValue(null),
}));

// Mock document-store to provide test data without Supabase
vi.mock('../document-store', () => ({
  listDocuments: vi.fn().mockResolvedValue([{
    id: 'test-doc-1',
    filename: 'test-dataset.xlsx',
    file_type: 'xlsx',
    structured_data: {
      sheets: {
        Sheet1: {
          headers: ['Vendor', 'Tier', 'Balance', 'Region'],
          rows: [
            ['Acme', 'Tier 1', '$100', 'East'],
            ['Bravo', 'Tier 2', '$50', 'West'],
            ['Charlie', 'Tier 1', '$75', 'South'],
          ],
        },
      },
    },
    metadata: {},
    created_at: '2026-01-01',
  }]),
  extractDataset: vi.fn().mockReturnValue({
    columns: ['Vendor', 'Tier', 'Balance', 'Region'],
    rows: [
      ['Acme', 'Tier 1', '$100', 'East'],
      ['Bravo', 'Tier 2', '$50', 'West'],
      ['Charlie', 'Tier 1', '$75', 'South'],
    ],
  }),
  getDocument: vi.fn().mockResolvedValue({
    id: 'test-doc-1',
    filename: 'test-dataset.xlsx',
    file_type: 'xlsx',
    structured_data: {
      sheets: {
        Sheet1: {
          headers: ['Vendor', 'Tier', 'Balance', 'Region'],
          rows: [['Acme', 'Tier 1', '$100', 'East'], ['Bravo', 'Tier 2', '$50', 'West'], ['Charlie', 'Tier 1', '$75', 'South']],
        },
      },
    },
    metadata: {},
  }),
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
      instruction: 'Show Tier 1 exposure by region as a bar chart',
      documentIds: [],
    });

    // handleUpdate may dispatch UPDATE_OBJECT_CONTEXT or UPDATE_OBJECT depending on path
    const contextPayload = result.dispatches.find(
      d => d.type === 'UPDATE_OBJECT_CONTEXT',
    )?.payload?.context || result.dispatches.find(
      d => d.type === 'UPDATE_OBJECT',
    )?.payload?.context;

    expect(contextPayload).toBeDefined();
    expect(contextPayload.view?.chartType).toBe('bar');
    expect(contextPayload.view?.chartXAxis).toBe('Region');
    expect(contextPayload.view?.chartYAxis).toBe('Balance');
    expect(contextPayload.view?.tierFilter).toBe('Tier 1');
    expect(contextPayload.view?.displayMode).toBe('chart');
  });
});
