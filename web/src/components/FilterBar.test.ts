import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import FilterBar from './FilterBar.vue';
import { useFilterStore } from '../stores/filter';
import type { Course } from '../types';

const courses: Course[] = [
  { id: 1, fullname: 'Algoritma dan Pemrograman', shortname: 'ALPRO', idnumber: 'IF101' },
  { id: 2, fullname: 'Basis Data', shortname: 'BD', idnumber: 'IF102' },
];

const mountFilterBar = () => mount(FilterBar, { props: { courses } });

describe('FilterBar', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('updates store.search when search input changes', async () => {
    const store = useFilterStore();
    const w = mountFilterBar();
    await w.get('[data-test="search"]').setValue('uts');
    expect(store.search).toBe('uts');
  });

  it('updates store.status when status select changes', async () => {
    const store = useFilterStore();
    const w = mountFilterBar();
    await w.get('[data-test="status"]').setValue('overdue');
    expect(store.status).toBe('overdue');
  });

  it('renders Semua + N course options and updates store.courseId', async () => {
    const store = useFilterStore();
    const w = mountFilterBar();
    const options = w.get('[data-test="course"]').findAll('option');
    expect(options.length).toBe(1 + courses.length);
    expect(options[0].text()).toBe('Semua mata kuliah');
    await w.get('[data-test="course"]').setValue('2');
    expect(store.courseId).toBe(2);
  });

  it('updates store.sortBy when sort select changes', async () => {
    const store = useFilterStore();
    const w = mountFilterBar();
    await w.get('[data-test="sort"]').setValue('name');
    expect(store.sortBy).toBe('name');
  });
});
