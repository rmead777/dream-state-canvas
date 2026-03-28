import { describe, it, expect } from 'vitest';
import { parseIntent } from '../intent-engine';
describe('parseIntent fallback', () => {
  it('returns a safe response-only action', async () => {
    const result = await parseIntent('hello world');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('respond');
  });

  it('does not create objects from keyword-only heuristics anymore', async () => {
    const result = await parseIntent('show me total AP exposure');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('respond');
    expect(result.actions.some((action) => action.type === 'create')).toBe(false);
  });
});
