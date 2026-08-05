import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import DetailPanel from './DetailPanel.vue';
import type { Assignment } from '../types';

const { getAssignmentDetailMock } = vi.hoisted(() => ({ getAssignmentDetailMock: vi.fn() }));
vi.mock('../api/client', () => ({
  getAssignmentDetail: (...args: unknown[]) => getAssignmentDetailMock(...args),
}));

function mountPanel(props: { assignment: Assignment | null; open: boolean }) {
  return mount(DetailPanel, { props });
}

const bodyText = () => document.body.textContent ?? '';
const bodyEls = (sel: string) => [...document.body.querySelectorAll(sel)];

async function clickTab(index: number) {
  const el = bodyEls('button[data-test="tab"]')[index];
  expect(el).toBeTruthy();
  // reka TabsTrigger activates on mousedown (not click).
  el.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
  await flushPromises();
}

const assignment: Assignment = {
  id: 1, name: 'Tugas 1', module: 'assign', eventType: 'due',
  duedate: Math.floor(Date.now() / 1000) + 3600, overdue: false,
  course: 'Struktur Diskret D', courseId: 7,
  assignmentId: 42, courseModuleId: 777,
};

describe('DetailPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = ''; // clear reka portals between tests
    getAssignmentDetailMock.mockReset();
    getAssignmentDetailMock.mockResolvedValue({
      assignmentId: 42,
      name: 'Tugas 1',
      descriptionHtml: '<p>Kerjakan laporan.</p>',
      files: [{ name: 'a.pdf', url: 'https://kulon2.undip.ac.id/x/a.pdf' }],
      submission: { status: 'graded', grade: 85, maxGrade: 100 },
      kulonUrl: 'https://kulon2.undip.ac.id/mod/assign/view.php?id=777',
    });
  });

  it('fetches detail when opened and renders tabs', async () => {
    mountPanel({ assignment, open: true });
    expect(getAssignmentDetailMock).toHaveBeenCalledWith(42, 777);
    await flushPromises();
    expect(bodyText()).toContain('Deskripsi');
    expect(bodyText()).toContain('File');
    expect(bodyText()).toContain('Submission');
    expect(bodyText()).toContain('Kerjakan laporan.');
  });

  it('shows files in File tab when selected', async () => {
    mountPanel({ assignment, open: true });
    await flushPromises();
    await clickTab(1);
    expect(bodyText()).toContain('a.pdf');
  });

  it('shows submission status in Submission tab', async () => {
    mountPanel({ assignment, open: true });
    await flushPromises();
    await clickTab(2);
    expect(bodyText()).toContain('85');
  });

  it('shows submission status in the header (glanceable)', async () => {
    mountPanel({ assignment, open: true });
    await flushPromises();
    const el = bodyEls('[data-test="submission-status"]')[0];
    expect(el).toBeTruthy();
    expect(el.textContent).toContain('Sudah dinilai');
  });

  it('shows retry on error', async () => {
    getAssignmentDetailMock.mockRejectedValue(new Error('network'));
    mountPanel({ assignment, open: true });
    await flushPromises();
    expect(bodyText()).toContain('Coba lagi');
  });

  it('renders header + open link only when cmid missing', async () => {
    const noCmid = { ...assignment, courseModuleId: undefined };
    mountPanel({ assignment: noCmid, open: true });
    await flushPromises();
    expect(getAssignmentDetailMock).not.toHaveBeenCalled();
    expect(bodyText()).toContain('Buka di Kulon');
  });

  it('emits close when close button clicked', async () => {
    const wrapper = mountPanel({ assignment, open: true });
    await flushPromises();
    const close = bodyEls('[data-test="close"]')[0];
    expect(close).toBeTruthy();
    close.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(wrapper.emitted('close')).toBeTruthy();
  });
});
