import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory } from "vue-router";
import { buildRouter } from "../router";
import KulonCourseDetailView from "./KulonCourseDetailView.vue";
import * as api from "../api/client";
import { useAuthStore } from "../stores/auth";
import { clearCache } from "../api/cache";

vi.mock("../api/client", () => ({
  getCourses: vi.fn(),
  getAssignments: vi.fn(),
  getAllAssignments: vi.fn(),
  getCourseContent: vi.fn(),
  getAssignmentDetail: vi.fn().mockResolvedValue({
    assignmentId: 1,
    name: "T1",
    descriptionHtml: "<p>x</p>",
    files: [],
    submission: { status: "not_submitted", grade: null, maxGrade: null },
    kulonUrl: "https://kulon2.undip.ac.id/mod/assign/view.php?id=1",
  }),
}));
vi.mock("../stores/auth", () => ({ useAuthStore: vi.fn() }));

function mockStore() {
  const store = {
    isAuthenticated: true,
    checking: false,
    login: vi.fn(),
    logout: vi.fn(),
    user: null,
    fetchMe: vi.fn().mockResolvedValue("ok"),
  };
  (useAuthStore as any).mockReturnValue(store);
}

describe("KulonCourseDetailView", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    clearCache();
    mockStore();
  });

  const content = {
    courseId: 9,
    sections: [
      {
        id: 0,
        label: "General",
        items: [
          {
            kind: "forum",
            name: "Announcements",
            url: "https://kulon/mod/forum/view.php?id=10",
            cmid: 10,
          },
        ],
      },
      {
        id: 1,
        label: "Pertemuan 1",
        dateRange: "9 February - 15 February",
        items: [
          {
            kind: "file",
            name: "Materi 1",
            url: "https://kulon/mod/resource/view.php?id=11",
            cmid: 11,
            fileType: "pdf",
          },
          {
            kind: "assign",
            name: "Tugas A",
            url: "https://kulon/mod/assign/view.php?id=12",
            cmid: 12,
            assignmentId: 5,
            duedate: 1700000000,
          },
        ],
      },
    ],
  };

  it("renders sections with pertemuan label and dateRange", async () => {
    (api.getCourseContent as any).mockResolvedValue(content);
    (api.getCourses as any).mockResolvedValue([
      {
        id: 9,
        fullname: "Keamanan dan Jaminan Informasi B",
        shortname: "KJI",
        idnumber: "",
        semester: "2025/2026 Genap",
      },
    ]);
    const router = buildRouter(createMemoryHistory());
    await router.push("/kulon/matakuliah/9");
    const w = mount(KulonCourseDetailView, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.text()).toContain("General");
    expect(w.text()).toContain("Pertemuan 1");
    expect(w.text()).toContain("9 February - 15 February");
    // Open section 1 to view items
    await w.find('[data-test="section-toggle-1"]').trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Materi 1");
    expect(w.text()).toContain("Tugas A");
  });

  it("opens DetailPanel when clicking an assign item", async () => {
    (api.getCourseContent as any).mockResolvedValue(content);
    (api.getCourses as any).mockResolvedValue([]);
    const router = buildRouter(createMemoryHistory());
    await router.push("/kulon/matakuliah/9");
    const w = mount(KulonCourseDetailView, { global: { plugins: [router] } });
    await flushPromises();
    await w.find('[data-test="section-toggle-1"]').trigger("click");
    await flushPromises();
    await w.find('[data-test="item-assign-12"]').trigger("click");
    await flushPromises();
    // DetailPanel teleports to body
    expect(document.body.textContent).toContain("Tugas A");
  });

  it("shows a category badge for every item kind", async () => {
    (api.getCourseContent as any).mockResolvedValue({
      courseId: 9,
      sections: [
        {
          id: 1,
          label: "Pertemuan 1",
          items: [
            {
              kind: "quiz",
              name: "Kuis 1",
              url: "https://kulon/mod/quiz/view.php?id=20",
              cmid: 20,
            },
            {
              kind: "forum",
              name: "Diskusi",
              url: "https://kulon/mod/forum/view.php?id=21",
              cmid: 21,
            },
            {
              kind: "url",
              name: "Link Materi",
              url: "https://kulon/mod/url/view.php?id=22",
              cmid: 22,
            },
            {
              kind: "page",
              name: "Halaman Materi",
              url: "https://kulon/mod/page/view.php?id=23",
              cmid: 23,
            },
          ],
        },
      ],
    });
    (api.getCourses as any).mockResolvedValue([]);
    const router = buildRouter(createMemoryHistory());
    await router.push("/kulon/matakuliah/9");
    const w = mount(KulonCourseDetailView, { global: { plugins: [router] } });
    await flushPromises();
    // If section 1 is collapsed, click to toggle open
    if (!w.text().includes("Kuis")) {
      await w.find('[data-test="section-toggle-1"]').trigger("click");
      await flushPromises();
    }
    expect(w.text()).toContain("Kuis");
    expect(w.text()).toContain("Forum");
    expect(w.text()).toContain("Link");
    expect(w.text()).toContain("Materi");
  });

  it("renders NO 'Minggu Ini' badge for sections whose month name isn't recognized (stray current-month fallback bug)", async () => {
    // Regression: sections with an unrecognized month used to silently fall back
    // to the *current* month (August) and could all get flagged "Minggu Ini".
    (api.getCourseContent as any).mockResolvedValue({
      courseId: 9,
      sections: [
        { id: 7, label: "Pertemuan 7", dateRange: "1 Xxx - 7 Xxx", items: [] },
        {
          id: 15,
          label: "Pertemuan 15",
          dateRange: "6 Xxx - 12 Xxx",
          items: [],
        },
      ],
    });
    (api.getCourses as any).mockResolvedValue([]);
    const router = buildRouter(createMemoryHistory());
    await router.push("/kulon/matakuliah/9");
    const w = mount(KulonCourseDetailView, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.text()).not.toContain("Minggu Ini");
  });

  it("shows the 'Minggu Ini' badge only on the section whose recognized (English) month is the current week", async () => {
    // Date-agnostic: build ranges from TODAY so the middle section is always
    // the current week, regardless of when the suite runs. (Previously this
    // hardcoded "2026-08-06" and went stale → pre-existing time-bomb.)
    const MONTH = {
      January: 0,
      February: 1,
      March: 2,
      April: 3,
      May: 4,
      June: 5,
      July: 6,
      August: 7,
      September: 8,
      October: 9,
      November: 10,
      December: 11,
    };
    const names = Object.keys(MONTH);
    const fmt = (d: Date) => `${d.getDate()} ${names[d.getMonth()]}`;
    const shift = (days: number) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      d.setFullYear(d.getFullYear());
      return d;
    };
    const year = new Date().getFullYear();
    const prev = shift(-14);
    const cur = shift(0);
    const next = shift(14);
    (api.getCourseContent as any).mockResolvedValue({
      courseId: 9,
      sections: [
        // Only the middle range includes today; prev/next are well outside.
        {
          id: 6,
          label: "Pertemuan 6",
          dateRange: `${fmt(prev)} - ${fmt(shift(-7))} ${year}`,
          items: [],
        },
        {
          id: 7,
          label: "Pertemuan 7",
          dateRange: `${fmt(cur)} - ${fmt(cur)} ${year}`,
          items: [],
        },
        {
          id: 15,
          label: "Pertemuan 15",
          dateRange: `${fmt(next)} - ${fmt(shift(14))} ${year}`,
          items: [],
        },
      ],
    });
    (api.getCourses as any).mockResolvedValue([]);
    const router = buildRouter(createMemoryHistory());
    await router.push("/kulon/matakuliah/9");
    const w = mount(KulonCourseDetailView, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.text()).toContain("Minggu Ini");
    // Exactly one occurrence.
    expect(w.text().match(/Minggu Ini/g)?.length).toBe(1);
  });

  it('shows a file-type badge for known types but hides it when fileType is "other" (JSON path)', async () => {
    (api.getCourseContent as any).mockResolvedValue({
      courseId: 9,
      sections: [
        {
          id: 1,
          label: "Pertemuan 1",
          items: [
            {
              kind: "file",
              name: "PDF Materi",
              url: "https://kulon/mod/resource/view.php?id=11",
              cmid: 11,
              fileType: "pdf",
            },
            {
              kind: "file",
              name: "File Tanpa Tipe",
              url: "https://kulon/mod/resource/view.php?id=12",
              cmid: 12,
              fileType: "other",
            },
          ],
        },
      ],
    });
    (api.getCourses as any).mockResolvedValue([]);
    const router = buildRouter(createMemoryHistory());
    await router.push("/kulon/matakuliah/9");
    const w = mount(KulonCourseDetailView, { global: { plugins: [router] } });
    await flushPromises();
    if (!w.text().includes("PDF Materi")) {
      await w.find('[data-test="section-toggle-1"]').trigger("click");
      await flushPromises();
    }
    expect(w.text()).toContain("PDF");
    expect(w.text()).not.toContain("OTHER");
  });
});
