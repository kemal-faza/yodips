import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import InteractiveHoverButton from './InteractiveHoverButton.vue';

describe('InteractiveHoverButton', () => {
  it('renders the text prop and pill classes', () => {
    const w = mount(InteractiveHoverButton, { props: { text: 'Login via SSO' } });
    expect(w.text()).toContain('Login via SSO');
    const btn = w.get('button');
    expect(btn.classes()).toContain('rounded-full');
    expect(btn.classes()).toContain('overflow-hidden');
    expect(btn.classes()).toContain('bg-background');
  });

  it('forwards click and extra attributes to the native button', async () => {
    const clickSpy = vi.fn();
    const w = mount(InteractiveHoverButton, {
      props: { text: 'X', class: 'mt-6 h-11 w-full' },
      attrs: { type: 'submit', 'data-test': 'login-btn', onClick: clickSpy },
    });
    const btn = w.get('button');
    expect(btn.attributes('type')).toBe('submit');
    expect(btn.attributes('data-test')).toBe('login-btn');
    expect(btn.classes()).toContain('mt-6');
    expect(btn.classes()).toContain('h-11');
    expect(btn.classes()).toContain('w-full');
    await btn.trigger('click');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
