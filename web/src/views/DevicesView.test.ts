import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('../api/client', () => ({
  pairRequest: vi.fn(),
  pairStatus: vi.fn(),
}));

import DevicesView from './DevicesView.vue';

describe('DevicesView', () => {
  it('renders the pairing card', () => {
    const w = mount(DevicesView);
    expect(w.text()).toContain('Perangkat');
    expect(w.find('[data-test="pairing-card"]').exists()).toBe(true);
  });
});
