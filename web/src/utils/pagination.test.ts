import { describe, expect, it } from 'vitest';
import { pageWindow } from './pagination';

describe('pageWindow', () => {
  it('returns all pages when total small', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });
  it('adds ellipses for large totals', () => {
    expect(pageWindow(1, 10)).toEqual([1, '…', 10]);
  });
  it('shows window around current', () => {
    expect(pageWindow(5, 10)).toEqual([1, '…', 4, 5, 6, '…', 10]);
  });
  it('clamps at edges', () => {
    expect(pageWindow(9, 10)).toEqual([1, '…', 8, 9, 10]);
  });
});
