import { describe, it, expect, vi } from 'vitest';
import { parseIntent } from '../intent-engine';
import { WorkspaceObject } from '../workspace-types';

// Mock callAI so we only test the keyword fallback path
vi.mock('@/hooks/useAI', () => ({
  callAI: vi.fn().mockResolvedValue(null),
}));

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

describe('parseIntent (keyword fallback)', () => {
  it('returns a respond action for unrecognized input', async () => {
    const result = await parseIntent('hello world');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('respond');
  });

  it('"exposure" triggers metric creation', async () => {
    const result = await parseIntent('show me total AP exposure');
    const actions = result.actions;
    expect(actions.some((a) => a.type === 'respond')).toBe(true);
    expect(actions.some((a) => a.type === 'create' && a.objectType === 'metric')).toBe(true);
  });

  it('"compare" triggers comparison creation', async () => {
    const result = await parseIntent('compare vendors');
    const actions = result.actions;
    expect(actions.some((a) => a.type === 'create' && a.objectType === 'comparison')).toBe(true);
  });

  it('"urgent" triggers alert creation', async () => {
    const result = await parseIntent('what needs urgent attention?');
    const actions = result.actions;
    expect(actions.some((a) => a.type === 'create' && a.objectType === 'alert')).toBe(true);
  });

  it('"table" triggers inspector creation', async () => {
    const result = await parseIntent('show me the top vendors table');
    const actions = result.actions;
    expect(actions.some((a) => a.type === 'create' && a.objectType === 'inspector')).toBe(true);
  });

  it('"summary" triggers brief creation', async () => {
    const result = await parseIntent('give me a summary');
    const actions = result.actions;
    expect(actions.some((a) => a.type === 'create' && a.objectType === 'brief')).toBe(true);
  });

  it('"timeline" triggers timeline creation', async () => {
    const result = await parseIntent('show activity timeline');
    const actions = result.actions;
    expect(actions.some((a) => a.type === 'create' && a.objectType === 'timeline')).toBe(true);
  });

  it('"dataset" triggers dataset creation', async () => {
    const result = await parseIntent('show the full dataset');
    const actions = result.actions;
    expect(actions.some((a) => a.type === 'create' && a.objectType === 'dataset')).toBe(true);
  });

  it('does not duplicate existing metric objects', async () => {
    const existing = makeObject({
      id: 'metric-1',
      type: 'metric',
      context: { label: 'ap-exposure' },
    });
    const result = await parseIntent('show AP exposure', { 'metric-1': existing });
    const creates = result.actions.filter((a) => a.type === 'create');
    expect(creates).toHaveLength(0);
    // Should focus existing instead
    expect(result.actions.some((a) => a.type === 'focus')).toBe(true);
  });

  it('"fuse" with two objects returns fuse action', async () => {
    const objA = makeObject({ id: 'a', title: 'Alpha', lastInteractedAt: 200 });
    const objB = makeObject({ id: 'b', title: 'Beta', lastInteractedAt: 100 });
    const existing = { a: objA, b: objB };
    const result = await parseIntent('fuse these together', existing);
    expect(result.actions.some((a) => a.type === 'fuse')).toBe(true);
  });

  it('"fuse" with fewer than 2 objects returns error response', async () => {
    const objA = makeObject({ id: 'a', title: 'Alpha' });
    const result = await parseIntent('fuse', { a: objA });
    expect(result.actions.some((a) => a.type === 'respond')).toBe(true);
    expect(result.actions.some((a) => a.type === 'fuse')).toBe(false);
  });
});
