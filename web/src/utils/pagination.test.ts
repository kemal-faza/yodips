import { describe, expect, it } from 'vitest';
import { pageWindow, pagedTasks, TASK_PAGE_SIZE } from './pagination';

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

describe('pagedTasks (port TASK_PAGE_SIZE Android)', () => {
  const list = Array.from({ length: 20 }, (_, i) => i);

  it('slice halaman pertama + sisa', () => {
    const { page, remaining } = pagedTasks(list, TASK_PAGE_SIZE);
    expect(page).toHaveLength(15);
    expect(remaining).toBe(5);
  });

  it('count negatif → halaman kosong aman', () => {
    const { page, remaining } = pagedTasks(list, -3);
    expect(page).toHaveLength(0);
    expect(remaining).toBe(20);
  });

  it('list kosong → sisa 0', () => {
    expect(pagedTasks([], 15)).toEqual({ page: [], remaining: 0 });
  });
});