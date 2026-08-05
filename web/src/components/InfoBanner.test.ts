import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import InfoBanner from './InfoBanner.vue';

describe('InfoBanner', () => {
  it('renders default title and message', () => {
    const w = mount(InfoBanner, { props: { message: 'Pastikan data diri benar.' } });
    expect(w.text()).toContain('Info');
    expect(w.text()).toContain('Pastikan data diri benar.');
  });

  it('renders custom title when provided', () => {
    const w = mount(InfoBanner, { props: { title: 'Perhatian', message: 'Cek ulang.' } });
    expect(w.text()).toContain('Perhatian');
  });
});
