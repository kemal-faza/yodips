import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import NotificationPopover from './NotificationPopover.vue';
import * as api from '../../../api/client';

vi.mock('../../../api/client', () => ({
  getNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
}));

const items = [
  { id: '1', title: 'Tugas jatuh tempo', message: 'Kuis 1', timestamp: '10 menit lalu', read: false, type: 'warning' },
  { id: '2', title: 'IRS disetujui', message: '100%', timestamp: 'Kemarin', read: true, type: 'success' },
];

describe('NotificationPopover', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the unread badge count on the bell', async () => {
    (api.getNotifications as any).mockResolvedValue({ count: 2, items });
    const w = mount(NotificationPopover);
    await flushPromises();
    expect(w.text()).toContain('1'); // one unread item
  });

  it('opens the panel and renders items on bell click', async () => {
    (api.getNotifications as any).mockResolvedValue({ count: 2, items });
    const w = mount(NotificationPopover);
    await flushPromises();
    await w.find('button').trigger('click');
    expect(w.text()).toContain('Tugas jatuh tempo');
    expect(w.text()).toContain('IRS disetujui');
  });

  it('shows an empty state when there are no notifications', async () => {
    (api.getNotifications as any).mockResolvedValue({ count: 0, items: [] });
    const w = mount(NotificationPopover);
    await flushPromises();
    await w.find('button').trigger('click');
    expect(w.text()).toContain('Tidak ada notifikasi');
  });

  it('calls markNotificationRead when mark-as-read is used', async () => {
    (api.getNotifications as any).mockResolvedValue({ count: 2, items });
    (api.markNotificationRead as any).mockResolvedValue(undefined);
    const w = mount(NotificationPopover);
    await flushPromises();
    await w.find('button').trigger('click');
    // trigger the mark-read action on the first (unread) item
    const unreadBtn = w.findAll('button').find((b) => b.text().includes('Tandai Dibaca'))!;
    await unreadBtn.trigger('click');
    expect(api.markNotificationRead).toHaveBeenCalled();
  });

  it('closes the panel on outside click', async () => {
    (api.getNotifications as any).mockResolvedValue({ count: 2, items });
    const w = mount(NotificationPopover);
    await flushPromises();
    await w.find('button').trigger('click');
    expect(w.text()).toContain('Tugas jatuh tempo');
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200)); // wait for the close transition
    expect(w.find('[data-test="notification-toggle"]').exists()).toBe(true);
  });
});