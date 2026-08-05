import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import SiapNotifikasi from './SiapNotifikasi.vue';

describe('SiapNotifikasi', () => {
  it('renders the Coming Soon state', () => {
    const w = mount(SiapNotifikasi);
    expect(w.text()).toContain('Notifikasi');
    expect(w.text()).toContain('Coming Soon');
  });
});
