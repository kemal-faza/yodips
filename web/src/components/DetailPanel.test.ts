import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

function setMatchMedia(query: string, matches: boolean) {
  (window as any).matchMedia = (q: string) => {
    const m = query === q ? matches : false;
    return {
      matches: m, media: q, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false,
    } as any;
  };
}

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
      descriptionHtml: '',
      descriptionMarkdown: '# Judul\n\n**Bold text**',
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
    expect(bodyText()).toContain('Bold text');
  });

  it('renders description as markdown (heading + bold)', async () => {
    getAssignmentDetailMock.mockResolvedValue({
      assignmentId: 42,
      name: 'Tugas 1',
      descriptionHtml: '',
      descriptionMarkdown: '# Judul\n\n**Bold text**',
      files: [],
      submission: { status: 'not_submitted' },
      kulonUrl: 'https://kulon2.undip.ac.id/',
    });
    mountPanel({ assignment, open: true });
    await flushPromises();
    const h1 = bodyEls('h1')[0];
    expect(h1?.textContent).toContain('Judul');
    // Root cause probe: heading harus punya visual hierarchy (bukan reset jadi
    // text-sm seperti yang tampil hari ini). jsdom tidak menghitung computed
    // font-size dari stylesheet (NaN) dan tidak men-scan CSS bundled ke
    // document.styleSheets, jadi kami verifikasi DI LEVEL FILE source CSS:
    // blok deskripsi punya rule yang menaikkan ukuran heading (h1 > body 14px).
    const mainCss = readFileSync(
      resolve(__dirname, '../assets/css/main.css'),
      'utf8',
    );
    expect(mainCss).toMatch(/\[data-test="description"\] h1/);
    expect(mainCss).toMatch(/font-size: 1\.5rem/);
    expect(bodyEls('strong').length).toBeGreaterThan(0);
    expect(bodyText()).toContain('Bold text');
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

  it('shows when submitted in the header (factual)', async () => {
    getAssignmentDetailMock.mockResolvedValue({
      assignmentId: 42,
      name: 'Tugas 1',
      descriptionHtml: '',
      descriptionMarkdown: '# Judul',
      files: [],
      submission: { status: 'submitted', submittedAt: Math.floor(Date.now() / 1000) - 3600 },
      kulonUrl: 'https://kulon2.undip.ac.id/',
    });
    mountPanel({ assignment: { ...assignment, submissionStatus: 'submitted' }, open: true });
    await flushPromises();
    expect(bodyText()).toContain('Dikumpulkan');
  });

  it('header badge uses card status (due/done/overdue), not deadline label', async () => {
    // graded -> card status = "done"
    mountPanel({ assignment: { ...assignment, submissionStatus: 'graded' }, open: true });
    await flushPromises();
    const badge = bodyEls('[data-test="header-status-badge"]')[0];
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('done');
    // The deadline-only labels must NOT appear in the sheet header.
    expect(bodyText()).not.toContain('On track');
    expect(bodyText()).not.toContain('Terlambat');
    expect(bodyText()).not.toContain('Segera');
  });

  it('header does not duplicate submission text label', async () => {
    mountPanel({ assignment: { ...assignment, submissionStatus: 'graded' }, open: true });
    await flushPromises();
    // Submission state is shown via the badge; the raw "Sudah dinilai" /
    // "Belum dikumpulkan" text label is dropped from the header.
    expect(bodyText()).not.toMatch(/Sudah dinilai|Belum dikumpulkan/);
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

  it('renders a right drawer at 50vw on desktop (md+)', async () => {
    setMatchMedia('(min-width: 768px)', true);
    mountPanel({ assignment, open: true });
    await flushPromises();
    const content = bodyEls('[data-slot="sheet-content"]')[0];
    expect(content?.getAttribute('data-side')).toBe('right');
    expect(content?.className).toContain('data-[side=right]:md:w-[50vw]');
    expect(content?.className).not.toMatch(/max-w-md/);
  });

  it('renders a bottom sheet ~85vh below md (tablet/phone)', async () => {
    setMatchMedia('(min-width: 768px)', false);
    mountPanel({ assignment, open: true });
    await flushPromises();
    const content = bodyEls('[data-slot="sheet-content"]')[0];
    expect(content?.getAttribute('data-side')).toBe('bottom');
    expect(content?.className).toContain('data-[side=bottom]:max-md:h-[85vh]');
  });

  it('description scroll container can shrink inside the flex column (min-h-0)', async () => {
    // Bug: the detail side-sheet cannot scroll for long descriptions. Root
    // cause is flexbox: the Tabs chain (SheetContent > Tabs > scroll div) uses
    // `flex-1` without `min-h-0`, so the inner overflow-y-auto div cannot
    // shrink below its content height → content overflows the fixed-height
    // sheet instead of scrolling. This test asserts the scroll container
    // carries the flex-shrink allowance.
    setMatchMedia('(min-width: 768px)', true);
    mountPanel({ assignment, open: true });
    await flushPromises();
    // The scrollable description region (overflow-y-auto inside flex-1 Tabs).
    const scrollEls = bodyEls('[data-slot="tabs-content"]').length
      ? bodyEls('[data-slot="tabs-content"]')
      : bodyEls('.overflow-y-auto');
    expect(scrollEls.length).toBeGreaterThan(0);
    // Every flex-1 ancestor in the scroll chain must allow shrinking (min-h-0)
    // so the inner overflow-y-auto actually scrolls; otherwise the panel grows
    // unbounded and the scrollbar never appears. (TabsTrigger buttons also use
    // flex-1 but are NOT part of the scroll chain — they just spread evenly.)
    const scrollRoot = bodyEls('[data-slot="sheet-content"]')[0];
    const chain = [
      ...bodyEls('[data-slot="tabs-root"]'),
      ...bodyEls('[data-slot="tabs-content"]'),
      ...(scrollRoot ? [scrollRoot] : []),
    ].filter((el) => [...el.classList].some((c) => c.startsWith('flex-1')));
    expect(chain.length).toBeGreaterThan(0);
    for (const el of chain) {
      expect([...el.classList].some((c) => c.startsWith('min-h-0'))).toBe(true);
    }
  });
});
