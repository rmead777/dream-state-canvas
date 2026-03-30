import { describe, it, expect } from 'vitest';
import { invalidateProfileCache } from '../intent-engine';

describe('intent-engine', () => {
  it('invalidateProfileCache does not throw', () => {
    // Smoke test — invalidateProfileCache resets the cached profile promise.
    // Full integration tests for refineDataRules require AI mocking.
    expect(() => invalidateProfileCache()).not.toThrow();
  });
});
