import { describe, expect, it, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import PaginationBar from './PaginationBar.vue';

describe('PaginationBar', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('emits change on next', async () => {
    const w = mount(PaginationBar, { props: { page: 1, totalPages: 3 } });
    await w.find('[data-test="next"]').trigger('click');
    expect(w.emitted('change')?.[0]).toEqual([2]);
  });

  it('disables next on last page and prev on first page', async () => {
    const first = mount(PaginationBar, { props: { page: 1, totalPages: 3 } });
    expect(first.find('[data-test="prev"]').attributes('disabled')).toBeDefined();
    const last = mount(PaginationBar, { props: { page: 3, totalPages: 3 } });
    expect(last.find('[data-test="next"]').attributes('disabled')).toBeDefined();
  });

  it('emits change when clicking a page number', async () => {
    const w = mount(PaginationBar, { props: { page: 1, totalPages: 3 } });
    await w.find('[data-test="page-3"]').trigger('click');
    expect(w.emitted('change')?.[0]).toEqual([3]);
  });

  it('does not render when only one page', () => {
    const w = mount(PaginationBar, { props: { page: 1, totalPages: 1 } });
    expect(w.find('[data-test="next"]').exists()).toBe(false);
  });
});