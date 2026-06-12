import { describe, expect, it } from 'vitest';
import { fisherYatesShuffle } from './shuffle';

describe('fisherYatesShuffle', () => {
  it('returns the same array reference', () => {
    const arr = [1, 2, 3];
    expect(fisherYatesShuffle(arr)).toBe(arr);
  });

  it('preserves all elements', () => {
    const arr = Array.from({ length: 50 }, (_, i) => i);
    const shuffled = fisherYatesShuffle([...arr]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(arr);
  });

  it('handles empty and single-element arrays', () => {
    expect(fisherYatesShuffle([])).toEqual([]);
    expect(fisherYatesShuffle([42])).toEqual([42]);
  });

  it('produces a roughly uniform distribution of first elements', () => {
    // Shuffle [0,1,2,3] many times; each value should land in slot 0
    // about 25% of the time. Allow a generous tolerance band so the
    // test is statistically stable (binomial stddev ≈ 0.97% at n=2000).
    const n = 2000;
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      counts[fisherYatesShuffle([0, 1, 2, 3])[0]]++;
    }
    for (const count of counts) {
      expect(count / n).toBeGreaterThan(0.18);
      expect(count / n).toBeLessThan(0.32);
    }
  });
});
