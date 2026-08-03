import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import DetailPanel from './DetailPanel.vue';
import type { Assignment } from '../types';

const { getAssignmentDetailMock } = vi.hoisted(() => ({ getAssignmentDetailMock: vi.fn() }));
vi.mock('../api/client', () => ({
  getAssignmentDetail: (...args: unknown[]) => getAssignmentDetailMock(...args),
}));

function mountPanel(props: { assignment: Assignment | null; open: boolean }) {
  return mount(DetailPanel, {
    props,
    global: { stubs: { teleport: true } },
  });
}

const assignment: Assignment = {
  id: 1, name: 'Tugas 1', module: 'assign', eventType: 'due',
  duedate: Math.floor(Date.now() / 1000) + 3600, overdue: false,
  course: 'Struktur Diskret D', courseId: 7,
  assignmentId: 42, courseModuleId: 777,
};

describe('DetailPanel', () => {
  beforeEach(() => {
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
    const wrapper = mountPanel({ assignment, open: true });
    expect(getAssignmentDetailMock).toHaveBeenCalledWith(42, 777);
    await flushPromises();
    expect(wrapper.text()).toContain('Deskripsi');
    expect(wrapper.text()).toContain('File');
    expect(wrapper.text()).toContain('Submission');
    expect(wrapper.text()).toContain('Kerjakan laporan.');
  });

  it('shows files in File tab when selected', async () => {
    const wrapper = mountPanel({ assignment, open: true });
    await flushPromises();
    await wrapper.findAll('button[data-test="tab"]')[1].trigger('click');
    expect(wrapper.text()).toContain('a.pdf');
  });

  it('shows submission status in Submission tab', async () => {
    const wrapper = mountPanel({ assignment, open: true });
    await flushPromises();
    await wrapper.findAll('button[data-test="tab"]')[2].trigger('click');
    expect(wrapper.text()).toContain('85');
  });

  it('shows retry on error', async () => {
    getAssignmentDetailMock.mockRejectedValue(new Error('network'));
    const wrapper = mountPanel({ assignment, open: true });
    await flushPromises();
    expect(wrapper.text()).toContain('Coba lagi');
  });

  it('renders header + open link only when cmid missing', async () => {
    const noCmid = { ...assignment, courseModuleId: undefined };
    const wrapper = mountPanel({ assignment: noCmid, open: true });
    expect(getAssignmentDetailMock).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Buka di Kulon');
  });

  it('emits close when backdrop/close clicked', async () => {
    const wrapper = mountPanel({ assignment, open: true });
    await wrapper.find('[data-test="close"]').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
  });
});