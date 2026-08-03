import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ViewToggle from './ViewToggle.vue';
import { useFilterStore } from '../stores/filter';

const mountViewToggle = () => mount(ViewToggle);

describe('ViewToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('defaults to timeline view and shows both labels', () => {
    const store = useFilterStore();
    const w = mountViewToggle();
    expect(store.viewMode).toBe('timeline');
    expect(w.text()).toContain('Kronologis');
    expect(w.text()).toContain('Per Mata Kuliah');
  });

  it('switches viewMode to course when Per Mata Kuliah is clicked', async () => {
    const store = useFilterStore();
    const w = mountViewToggle();
    const buttons = w.findAll('button');
    const courseBtn = buttons.find((b) => b.text() === 'Per Mata Kuliah');
    expect(courseBtn).toBeTruthy();
    await courseBtn!.trigger('click');
    expect(store.viewMode).toBe('course');
  });
});
