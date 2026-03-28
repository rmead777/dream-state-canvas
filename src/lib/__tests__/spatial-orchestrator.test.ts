import { describe, it, expect } from 'vitest';
import { computeLayout, computeLayoutWithOverflow } from '../spatial-orchestrator';
import { WorkspaceObject } from '../workspace-types';

function makeObject(overrides: Partial<WorkspaceObject> = {}): WorkspaceObject {
  return {
    id: `obj-${Math.random().toString(36).slice(2, 8)}`,
    type: 'metric',
    title: 'Test',
    status: 'open',
    pinned: false,
    origin: { type: 'user-query', query: 'test' },
    relationships: [],
    context: {},
    position: { zone: 'primary', order: 0 },
    createdAt: Date.now(),
    lastInteractedAt: Date.now(),
    ...overrides,
  };
}

function toRecord(...objs: WorkspaceObject[]): Record<string, WorkspaceObject> {
  const record: Record<string, WorkspaceObject> = {};
  for (const obj of objs) record[obj.id] = obj;
  return record;
}

describe('computeLayout', () => {
  it('returns empty layout for no objects', () => {
    const layout = computeLayout({});
    expect(layout.primary).toEqual([]);
    expect(layout.secondary).toEqual([]);
    expect(layout.peripheral).toEqual([]);
  });

  it('places a single open object in primary', () => {
    const obj = makeObject({ id: 'a', status: 'open' });
    const layout = computeLayout(toRecord(obj));
    expect(layout.primary).toEqual(['a']);
    expect(layout.secondary).toEqual([]);
  });

  it('places up to 2 objects in primary', () => {
    const a = makeObject({ id: 'a', lastInteractedAt: 200 });
    const b = makeObject({ id: 'b', lastInteractedAt: 100 });
    const layout = computeLayout(toRecord(a, b));
    expect(layout.primary).toEqual(['a', 'b']);
    expect(layout.secondary).toEqual([]);
  });

  it('overflows 3rd and 4th objects to secondary', () => {
    const objs = [1, 2, 3, 4].map((i) =>
      makeObject({ id: `obj-${i}`, lastInteractedAt: 1000 - i * 100 })
    );
    const layout = computeLayout(toRecord(...objs));
    expect(layout.primary).toHaveLength(2);
    expect(layout.secondary).toHaveLength(2);
  });

  it('pinned objects sort before unpinned', () => {
    const pinned = makeObject({ id: 'pinned', pinned: true, lastInteractedAt: 1 });
    const recent = makeObject({ id: 'recent', pinned: false, lastInteractedAt: 9999 });
    const layout = computeLayout(toRecord(pinned, recent));
    expect(layout.primary[0]).toBe('pinned');
  });

  it('collapsed objects go to peripheral', () => {
    const open = makeObject({ id: 'open', status: 'open' });
    const collapsed = makeObject({ id: 'collapsed', status: 'collapsed' });
    const layout = computeLayout(toRecord(open, collapsed));
    expect(layout.primary).toEqual(['open']);
    expect(layout.peripheral).toEqual(['collapsed']);
  });

  it('dissolved objects appear in no zone', () => {
    const dissolved = makeObject({ id: 'dissolved', status: 'dissolved' });
    const layout = computeLayout(toRecord(dissolved));
    expect(layout.primary).toEqual([]);
    expect(layout.secondary).toEqual([]);
    expect(layout.peripheral).toEqual([]);
  });
});

describe('computeLayoutWithOverflow', () => {
  it('returns overflow when more than 4 open objects exist', () => {
    const objs = [1, 2, 3, 4, 5].map((i) =>
      makeObject({ id: `obj-${i}`, lastInteractedAt: 1000 - i * 100 })
    );
    const result = computeLayoutWithOverflow(toRecord(...objs));
    expect(result.layout.primary).toHaveLength(2);
    expect(result.layout.secondary).toHaveLength(2);
    expect(result.overflow).toHaveLength(1);
    expect(result.overflow[0]).toBe('obj-5'); // least recently interacted
  });

  it('returns empty overflow when under capacity', () => {
    const objs = [1, 2, 3].map((i) =>
      makeObject({ id: `obj-${i}`, lastInteractedAt: 1000 - i * 100 })
    );
    const result = computeLayoutWithOverflow(toRecord(...objs));
    expect(result.overflow).toEqual([]);
  });

  it('every non-dissolved object appears in a zone or overflow', () => {
    const objs = [1, 2, 3, 4, 5, 6].map((i) =>
      makeObject({ id: `obj-${i}`, lastInteractedAt: 1000 - i * 100 })
    );
    const collapsed = makeObject({ id: 'c1', status: 'collapsed' });
    const dissolved = makeObject({ id: 'd1', status: 'dissolved' });
    const all = toRecord(...objs, collapsed, dissolved);

    const result = computeLayoutWithOverflow(all);
    const allPlaced = [
      ...result.layout.primary,
      ...result.layout.secondary,
      ...result.layout.peripheral,
      ...result.overflow,
    ];

    // Every non-dissolved object must appear somewhere
    for (const [id, obj] of Object.entries(all)) {
      if (obj.status !== 'dissolved') {
        expect(allPlaced).toContain(id);
      }
    }
    // Dissolved objects must not appear
    expect(allPlaced).not.toContain('d1');
  });
});
