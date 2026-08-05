import { describe, expect, it, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import SsoDashboard from './SsoDashboard.vue';

describe('SsoDashboard', () => {
  beforeEach(() => localStorage.clear());

  it('shows the welcome banner and service grid', () => {
    const w = mount(SsoDashboard);
    expect(w.text()).toContain('Selamat datang di Undip SSO');
    expect(w.text()).toContain('Layanan');
  });

  it('emits navigate "siap" when the SIAP card is clicked', async () => {
    const w = mount(SsoDashboard);
    await w.find('[data-test="service-siap"]').trigger('click');
    expect(w.emitted('navigate')?.[0]).toEqual(['siap']);
  });

  it('emits navigate "kulon" when Kulon is clicked', async () => {
    const w = mount(SsoDashboard);
    await w.find('[data-test="service-kulon"]').trigger('click');
    expect(w.emitted('navigate')?.[0]).toEqual(['kulon']);
    expect(w.text()).toContain('Kulon');
    expect(w.text()).not.toContain('Online Courses');
  });

  it('does NOT emit navigate for Coming Soon services', async () => {
    const w = mount(SsoDashboard);
    await w.find('[data-test="service-mandala"]').trigger('click');
    expect(w.emitted('navigate')).toBeUndefined();
    expect(w.text()).toContain('Coming Soon');
  });

  it('dismisses the welcome banner and remembers it in localStorage', async () => {
    const w = mount(SsoDashboard);
    await w.findAll('button').find((b) => b.text().includes('Tutup'))!.trigger('click');
    expect(w.text()).not.toContain('Selamat datang di Undip SSO');
    expect(localStorage.getItem('sso_welcome_dismissed')).toBe('1');
  });
});
