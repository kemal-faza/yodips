import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MultiStepLoader from './MultiStepLoader.vue';

const steps = [
  { text: 'SSO' },
  { text: 'Kulon' },
  { text: 'SIAP' },
];

describe('MultiStepLoader', () => {
  it('renders nothing when loading is false', () => {
    const w = mount(MultiStepLoader, { props: { steps, current: 0, loading: false } });
    expect(w.find('svg').exists()).toBe(false);
  });

  it('renders all step texts when loading', () => {
    const w = mount(MultiStepLoader, { props: { steps, current: 0, loading: true } });
    expect(w.text()).toContain('SSO');
    expect(w.text()).toContain('Kulon');
    expect(w.text()).toContain('SIAP');
  });

  it('shows a check icon for completed steps and spinner for the active step', () => {
    const w = mount(MultiStepLoader, { props: { steps, current: 1, loading: true } });
    const svgs = w.findAll('svg');
    // step 0 done (CircleCheck), step 1 active (LoaderCircle), step 2 pending (Circle)
    expect(svgs.length).toBe(3);
    expect(svgs[0].classes().join(' ')).toContain('lucide-circle-check');
    expect(svgs[1].classes().join(' ')).toContain('lucide-loader-circle');
    expect(svgs[2].classes().join(' ')).toContain('lucide-circle');
  });

  it('hides the close button when preventClose is true (default)', () => {
    const w = mount(MultiStepLoader, { props: { steps, current: 0, loading: true } });
    expect(w.find('button').exists()).toBe(false);
  });

  it('emits close when the close button is clicked', async () => {
    const w = mount(MultiStepLoader, {
      props: { steps, current: 0, loading: true, preventClose: false },
    });
    const btn = w.find('button');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    expect(w.emitted('close')).toBeTruthy();
  });

  it('renders default slot content inside the overlay', () => {
    const w = mount(MultiStepLoader, {
      props: { steps, current: 2, loading: true },
      slots: { default: '<button class="selesai">Selesai login</button>' },
    });
    expect(w.get('.selesai').text()).toBe('Selesai login');
  });
});