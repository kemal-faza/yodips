import { beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import FilterBar from './FilterBar.vue';
import { useFilterStore } from '../stores/filter';
import type { Course } from '../types';

const courses: Course[] = [
  { id: 1, fullname: 'Algoritma dan Pemrograman', shortname: 'ALPRO', idnumber: 'IF101' },
  { id: 2, fullname: 'Basis Data', shortname: 'BD', idnumber: 'IF102' },
];

const mountFilterBar = () => mount(FilterBar, { props: { courses } });

function openSelect(w: { get: (s: string) => { element: Element } }, dataTest: string) {
  const el = w.get(`[data-test="${dataTest}"]`).element;
  el.dispatchEvent(new MouseEvent('pointerdown', { button: 0, ctrlKey: false, bubbles: true }));
}

function clickOption(text: string) {
  const option = [...document.body.querySelectorAll('[role="option"]')].find(
    (el) => el.textContent?.trim() === text || el.textContent?.includes(text),
  );
  expect(option).toBeTruthy();
  option!.dispatchEvent(new MouseEvent('pointerup', { button: 0, ctrlKey: false, bubbles: true }));
}

describe('FilterBar', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    document.body.innerHTML = ''; // clear any leftover reka portals
  });

  it('updates store.search when search input changes', async () => {
    const store = useFilterStore();
    const w = mountFilterBar();
    await w.get('[data-test="search"]').setValue('uts');
    expect(store.search).toBe('uts');
  });

  it('updates store.status when a status option is chosen', async () => {
    const store = useFilterStore();
    const w = mountFilterBar();
    openSelect(w, 'status');
    await flushPromises();
    clickOption('Terlambat');
    await flushPromises();
    expect(store.status).toBe('overdue');
  });

  it('renders Semua + N course options and updates store.courseId', async () => {
    const store = useFilterStore();
    const w = mountFilterBar();
    openSelect(w, 'course');
    await flushPromises();
    const options = [...document.body.querySelectorAll('[role="option"]')];
    expect(options.length).toBe(1 + courses.length);
    expect(options[0].textContent).toContain('Semua mata kuliah');
    clickOption('Basis Data');
    await flushPromises();
    expect(store.courseId).toBe(2);
  });

  it('updates store.sortBy when a sort option is chosen', async () => {
    const store = useFilterStore();
    const w = mountFilterBar();
    openSelect(w, 'sort');
    await flushPromises();
    clickOption('Nama');
    await flushPromises();
    expect(store.sortBy).toBe('name');
  });

  it('shows clear button only when a filter is active and resets on click', async () => {
    const store = useFilterStore();
    const w = mountFilterBar();
    expect(w.find('[data-test="clear-filters"]').exists()).toBe(false);
    await w.get('[data-test="search"]').setValue('uts');
    expect(w.find('[data-test="clear-filters"]').exists()).toBe(true);
    await w.find('[data-test="clear-filters"]').trigger('click');
    await flushPromises();
    expect(store.search).toBe('');
    expect(store.status).toBe('all');
    expect(store.courseId).toBe('all');
    expect(w.find('[data-test="clear-filters"]').exists()).toBe(false);
  });
});
