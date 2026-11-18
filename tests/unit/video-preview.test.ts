import { describe, expect, it } from 'vitest';
import { toSeconds } from '../../src/tools/custom/_frame-preview';

describe('video trim preview', () => {
  it('reads times as the trim fields accept them', () => {
    expect(toSeconds('65.5')).toBe(65.5);
    expect(toSeconds('1:05.5')).toBe(65.5);
    expect(toSeconds(' 1:01:05 ')).toBe(3665);
    expect(toSeconds('')).toBeNull();
    expect(toSeconds('1:x')).toBeNull();
    expect(toSeconds('1:2:3:4')).toBeNull();
  });
});
