import 'reflect-metadata';
import fs from 'fs';
import path from 'path';
import {
  KulonService,
  parseSemester,
  extractFileType,
  deriveSectionLabel,
  extractCourseCode,
  parseSectionProgress,
} from './kulon.service';
import { StaleUpstreamError } from '../upstream/upstream-fetch';
import { KulonUpstreamSession } from './kulon-upstream.session';
import {
  parseAssignmentIndex,
  parseMoodleDate,
  parseQuizIndex,
} from './kulon-parse';

describe('parseSemester', () => {
  it('extracts semester from fullname', () => {
    expect(parseSemester('S1 2025/2026 Genap Keamanan dan Jaminan Informasi B')).toBe('2025/2026 Genap');
  });
  it('returns null when no pattern', () => {
    expect(parseSemester('Pemrograman Berorientasi Objek E')).toBeNull();
  });
  it('falls back to idnumber', () => {
    expect(parseSemester('KJI B', 'MIK1624601 S1 2025/2026 Genap')).toBe('2025/2026 Genap');
  });
  it('handles Ganjil and case-insensitive', () => {
    expect(parseSemester('S1 2024/2025 ganjil Algoritma')).toBe('2024/2025 Ganjil');
  });
});

describe('extractFileType', () => {
  it.each([
    ['https://kulon/pl/pluginfile.php/1.pdf', 'pdf'],
    ['https://kulon/theme/image.php/moove/core/1/f/pdf', 'pdf'],
    ['https://kulon/theme/image.php/moove/core/1/f/vnd.ms-powerpoint', 'pptx'],
    ['https://kulon/theme/image.php/moove/core/1/f/pptx', 'pptx'],
    ['https://kulon/theme/image.php/moove/core/1/f/edit-doc', 'doc'],
    ['https://kulon/mod/resource/view.php?id=5', 'other'],
    ['https://kulon/a/notes.pptx?forcedownload=1', 'pptx'],
    ['https://kulon/x.DOC', 'doc'],
    ['https://kulon/y.xlsx', 'xlsx'],
  ])('%s -> %s', (url, expected) => expect(extractFileType(url)).toBe(expected));
});

describe('deriveSectionLabel', () => {
  it('labels section 0 as General', () => {
    expect(deriveSectionLabel(0, 'General')).toEqual({ label: 'General' });
  });
  it('synthesizes Pertemuan N for a pure date-range title', () => {
    expect(deriveSectionLabel(1, '9 February - 15 February')).toEqual({
      label: 'Pertemuan 1',
      dateRange: '9 February - 15 February',
    });
  });
  it('keeps a custom name without dateRange', () => {
    expect(deriveSectionLabel(2, 'Pertemuan 11')).toEqual({ label: 'Pertemuan 11' });
  });
  it('strips surrounding whitespace', () => {
    expect(deriveSectionLabel(3, '  Bab 4  ')).toEqual({ label: 'Bab 4' });
  });
});

describe('extractCourseCode', () => {
  const RAW = '[SIAP] [55201] [K2024] [Reguler] [MIK1624105] S1 2024/2025 Ganjil Aljabar Linier D';

  it('extracts bracketed MIK-style code from shortname', () => {
    expect(extractCourseCode(RAW, 'S1 2024/2025 Ganjil Aljabar Linier D')).toBe('MIK1624105');
  });
  it('falls back to fullname when shortname has no bracketed code', () => {
    expect(extractCourseCode('CA', 'S1 [MIK1624503] Sistem Informasi')).toBe('MIK1624503');
  });
  it('ignores non-code bracket tokens and passes original shortname through', () => {
    // [SIAP]/[Reguler] letters-only, [55201] digits-only, [K2024] 1-letter+4-digits
    // -> no [A-Z]{2,3}\d{5,} token, so the helper returns the original shortname untouched.
    expect(extractCourseCode('[SIAP] [55201] [K2024] [Reguler] X', '')).toBe('[SIAP] [55201] [K2024] [Reguler] X');
  });
  it('returns original shortname when neither shortname nor fullname has a code', () => {
    expect(extractCourseCode('CA', 'Course A')).toBe('CA');
    expect(extractCourseCode('K', 'Kripto')).toBe('K');
  });
});

describe('parseSectionProgress', () => {
  const section = (label: string, dateRange?: string) => ({ id: 1, label, dateRange, items: [] });
  const now = new Date(2026, 1, 20); // 20 Feb 2026

  it('returns undefined when no dated sections', () => {
    expect(parseSectionProgress([section('General'), section('Bab 1')], now)).toBeUndefined();
  });
  it('counts a dated section as ended when its end date has passed', () => {
    expect(parseSectionProgress([section('P1', '1 February - 8 February')], now)).toBe(100);
  });
  it('does not count a dated section that has not ended yet', () => {
    expect(parseSectionProgress([section('P1', '15 March - 22 March')], now)).toBe(0);
  });
  it('computes a partial ratio (1 of 2 ended = 50)', () => {
    expect(parseSectionProgress([
      section('P1', '1 February - 5 February'),
      section('P2', '1 March - 5 March'),
    ], now)).toBe(50);
  });
  it('ignores sections with unparseable dateRange and uses only parseable ones', () => {
    expect(parseSectionProgress([
      section('P1', '1 February - 5 February'),
      section('P2', 'weird'),
    ], now)).toBe(100);
  });
  it('returns 100 for a PAST course even when its end-date month is ahead of now (year inference fails for past semesters)', () => {
    // A past-semester course (ended Dec 2024) whose section end month is "December":
    // with now = 20 Feb 2026, the old year-inference checked Dec 2026 & Dec 2027 (both
    // future) and misclassified it as not-ended -> 0%. A past course must be 100%.
    expect(parseSectionProgress(
      [section('P1', '1 December - 15 December')],
      now,
      { isPast: true },
    )).toBe(100);
  });
  it('keeps inprogress logic when isPast is false (a not-yet-ended section stays 0)', () => {
    expect(parseSectionProgress(
      [section('P1', '15 March - 22 March')],
      now,
      { isPast: false },
    )).toBe(0);
  });
});



describe('sub-based session resolution (endpoint API)', () => {
  const SESSKEY_PAGE =
    '<html><input type="hidden" name="sesskey" value="sk123"></html>';
  const LOGIN_PAGE = '<html><head><title>Login</title></head></html>';

  function svcWith(session?: {
    kulonCookie?: string;
    siapCookie?: string;
  }): KulonService {
    const store = { get: jest.fn().mockResolvedValue(session ?? null) } as any;
    // Real seam wired with the same session-store fake: getContext resolves
    // the cookie from the store, fetchSesskeyOrThrow probes via global.fetch.
    return new KulonService(
      undefined,
      undefined,
      new KulonUpstreamSession(store),
      store,
    );
  }

  const ok = (body: string, url: string) => ({
    ok: true,
    status: 200,
    url,
    text: async () => body,
    json: async () => JSON.parse(body),
  });

  it('getCourseContent resolves cookie + sesskey from SessionStore by sub', async () => {
    const stateBody = JSON.stringify([
      { error: false, data: { course: {}, section: [], cm: [] } },
    ]);
    global.fetch = jest.fn(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/my/')) return ok(SESSKEY_PAGE, url);
      if (url.includes('/lib/ajax/service.php')) {
        expect(init?.headers?.Cookie).toBe('MoodleSession=K');
        return ok(stateBody, url);
      }
      throw new Error(`unmocked fetch: ${url}`);
    }) as any;
    const content = await svcWith({ kulonCookie: 'MoodleSession=K' }).getCourseContent('u1', 77);
    expect(content.courseId).toBe(77);
  });

  it('throws a typed stale 401 when no Kulon session exists for sub', async () => {
    global.fetch = jest.fn();
    await expect(
      svcWith(undefined).getCourses('u1'),
    ).rejects.toBeInstanceOf(StaleUpstreamError);
    await expect(svcWith(undefined).getCourses('u1')).rejects.toMatchObject({
      status: 401,
    });
    await expect(svcWith({ kulonCookie: '' }).getAssignments('u1')).rejects.toThrow(
      'Kulon session belum ada. Silakan login ulang via SSO',
    );
  });

  it('propagates the probe stale 401 (login page) instead of a raw fetch error', async () => {
    global.fetch = jest.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/my/')) return ok(LOGIN_PAGE, url);
      throw new Error(`unmocked fetch: ${url}`);
    }) as any;
    await expect(
      svcWith({ kulonCookie: 'MoodleSession=OLD' }).getCourseContent('u1', 77),
    ).rejects.toBeInstanceOf(StaleUpstreamError);
  });
});

/**
 * Service whose endpoint API resolves `sub` via a fixed session; the sesskey
 * probe is stubbed (probe behaviour is covered by kulon-upstream + sub-based
 * specs) while AJAX transport stays real against the mocked global.fetch.
 * The REAL seam is wired with the same session-store fake so getContext can
 * resolve the cookie from it; its own fetchSesskeyOrThrow is overridden at
 * the instance level so no /my/ probe hits global.fetch (sesskey is canned).
 */
function makeAuthedKulonSvc(opts: { cache?: any; siap?: any } = {}): KulonService {
  const store = {
    get: async () => ({
      kulonCookie: 'session-cookie',
      siapCookie: 'siap-cookie',
    }),
  } as any;
  const real = new KulonUpstreamSession(store);
  (real as any).fetchSesskeyOrThrow = async () => 'sesskey123';
  const upstream = {
    fetchSesskeyOrThrow: async () => 'sesskey123',
    getContext: (sub?: string) => real.getContext(sub),
    ajax: (...args: Parameters<KulonUpstreamSession['ajax']>) =>
      real.ajax(...args),
    checkSessionValid: (cookie: string) => real.checkSessionValid(cookie),
  };
  return new KulonService(
    opts.cache,
    opts.siap,
    upstream as any,
    store,
  );
}

describe('getCourseContent (HTML fixture)', () => {
  it('parses real Kulon HTML into sections/items', async () => {
    const svc = makeAuthedKulonSvc();
    const html = fs.readFileSync(
      path.join(__dirname, '../../test/fixtures/kulon/course-content-html.html'),
      'utf8',
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://kulon2.undip.ac.id/course/view.php?id=16294',
      text: async () => html,
    }) as any;
    const content = await svc.getCourseContent('u1', 16294);
    expect(content.courseId).toBe(16294);
    // Section 0 = General (forum Announcements).
    const gen = content.sections.find((s) => s.id === 0);
    expect(gen?.label).toBe('General');
    expect(gen?.items[0]?.kind).toBe('forum');
    // Section 1: title date-range -> Pertemuan 1 + dateRange; file pdf.
    const s1 = content.sections.find((s) => s.id === 1);
    expect(s1?.label).toBe('Pertemuan 1');
    expect(s1?.dateRange).toBe('9 February - 15 February');
    const fileItem = s1?.items.find((i) => i.kind === 'file');
    expect(fileItem?.fileType).toBe('pdf');
    expect(fileItem?.name).toBe('0. Peraturan Perkuliahan');
    // Section 12: file + assign (assign ter-bucket benar meski di luar block regex).
    const s12 = content.sections.find((s) => s.id === 12);
    const assignItem = s12?.items.find((i) => i.kind === 'assign');
    expect(assignItem?.kind).toBe('assign');
    expect(assignItem?.name).toBe('Tugas Kriptografi');
    expect(s12?.items.every((i) => i.kind === 'file' || i.kind === 'assign')).toBe(true);
    // Section 13: custom name "Pertemuan 11" dipertahankan (bukan synthesize ulang).
    const s13 = content.sections.find((s) => s.id === 13);
    expect(s13?.label).toBe('Pertemuan 11');
  });

  it('captures items whose description contains nested divs before the link (B12)', async () => {
    const svc = makeAuthedKulonSvc();
    // An activity-item whose intro has nested <div>s (HTML rich description)
    // BEFORE the <a> link. The old div-pairing regex (`</div></div>`) would
    // truncate the wrapper at the inner `</div></div>` and drop the link.
    const html =
      '<li id="section-2" data-sectionname="Pertemuan 2">' +
      '<ul class="section ">' +
      '<li class="activity modtype_assign ">' +
      '<div class="activity-item focus-control " data-activityname="Tugas Berdokumen" data-region="activity-card">' +
      '<div class="activity-instruction"><div><p>Kumpulkan laporan.</p></div></div>' +
      '<a href="https://kulon2.undip.ac.id/mod/assign/view.php?id=50501" class="aalink">Tugas Berdokumen</a>' +
      '</div>' +
      '</li>' +
      '</ul>' +
      '</li>';

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://kulon2.undip.ac.id/course/view.php?id=77',
      text: async () => html,
    }) as any;

    const content = await svc.getCourseContent('u1', 77);
    const s2 = content.sections.find((s) => s.id === 2);
    const item = s2?.items[0];
    expect(item?.kind).toBe('assign');
    expect(item?.name).toBe('Tugas Berdokumen');
    expect(item?.cmid).toBe(50501);
  });

  it('skips activity items that carry no module link (Moodle labels)', async () => {
    const svc = makeAuthedKulonSvc();
    const html =
      '<li id="section-1" data-sectionname="Pertemuan 1">' +
      '<ul class="section ">' +
      '<li class="activity modtype_label ">' +
      '<div class="activity-item focus-control " data-activityname="Sekedar label" data-region="activity-card">' +
      '<div class="activity-grid noname-grid"><div class="activity-altcontent"><p>Sekedar label</p></div></div>' +
      '</div>' +
      '</li>' +
      '</ul>' +
      '</li>';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://kulon2.undip.ac.id/course/view.php?id=77',
      text: async () => html,
    }) as any;
    const content = await svc.getCourseContent('u1', 77);
    const s1 = content.sections.find((s) => s.id === 1);
    expect(s1?.items).toEqual([]);
  });

  it('falls back to HTML when the JSON endpoint is unavailable (no json() on response)', async () => {
    const svc = makeAuthedKulonSvc();
    const html = fs.readFileSync(
      path.join(__dirname, '../../test/fixtures/kulon/course-content-html.html'),
      'utf8',
    );
    // First call = service.php (JSON path) returns a response WITHOUT json() -> TypeError.
    // Second call = /course/view.php HTML path.
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://kulon2.undip.ac.id/lib/ajax/service.php?sesskey=sk',
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://kulon2.undip.ac.id/course/view.php?id=16294',
        text: async () => html,
      });
    const content = await svc.getCourseContent('u1', 16294);
    expect(content.courseId).toBe(16294);
    const gen = content.sections.find((s) => s.id === 0);
    expect(gen?.label).toBe('General');
  });

  it('falls back to HTML when the JSON endpoint returns 200 but no section array (malformed state)', async () => {
    const svc = makeAuthedKulonSvc();
    const html = fs.readFileSync(
      path.join(__dirname, '../../test/fixtures/kulon/course-content-html.html'),
      'utf8',
    );
    // First call = service.php (JSON path) returns a well-formed but unusable body
    // (no `section` array) -> getCourseState throws -> fall back to HTML.
    // Second call = /course/view.php HTML path.
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://kulon2.undip.ac.id/lib/ajax/service.php?sesskey=sk',
        json: async () => [{ error: false, data: { course: { id: '16294' } } }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://kulon2.undip.ac.id/course/view.php?id=16294',
        text: async () => html,
      });
    const content = await svc.getCourseContent('u1', 16294);
    expect(content.courseId).toBe(16294);
    const gen = content.sections.find((s) => s.id === 0);
    expect(gen?.label).toBe('General');
  });
});

describe('KulonService', () => {
  let svc: KulonService;
  beforeEach(() => {
    svc = makeAuthedKulonSvc();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    (global.fetch as jest.Mock).mockReset();
  });

  it('gets courses from timeline endpoint (all + inprogress + hidden), strips [SIAP] prefix, tags timelineStatus', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            error: false,
            data: {
              courses: [
                { id: 1, fullname: '[SIAP] Course A', shortname: 'CA', idnumber: '1' },
                { id: 2, fullname: 'Course B', shortname: 'CB', idnumber: '2' },
              ],
            },
          },
        ],
      })
      // inprogress classification = Moodle's own "active now" bucket (id 1)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            error: false,
            data: {
              courses: [{ id: 1, fullname: '[SIAP] Course A', shortname: 'CA', idnumber: '1' }],
            },
          },
        ],
      })
      // hidden classification returns the "removed from view" course (id 3)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            error: false,
            data: {
              courses: [
                { id: 1, fullname: '[SIAP] Course A', shortname: 'CA', idnumber: '1' },
                { id: 3, fullname: 'Course C', shortname: 'CC', idnumber: '3' },
              ],
            },
          },
        ],
      })
      // post-timeline content scrapes (one per course) so the progress path
      // resolves without consuming the timeline mock queue
      .mockResolvedValueOnce({ ok: true, text: async () => '<html></html>' })
      .mockResolvedValueOnce({ ok: true, text: async () => '<html></html>' })
      .mockResolvedValueOnce({ ok: true, text: async () => '<html></html>' });

    const courses = await svc.getCourses('u1');

    // merge + dedupe: A and B visible, C hidden
    expect(courses.map((c) => c.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);

    // [SIAP] prefix stripped
    const courseA = courses.find((c) => c.id === 1);
    expect(courseA?.fullname).toBe('Course A');
    // non-prefixed course left untouched
    expect(courses.find((c) => c.id === 2)?.fullname).toBe('Course B');

    // timelineStatus: id 1 is in the 'inprogress' bucket -> active; id 2/3 -> past
    expect(courses.find((c) => c.id === 1)?.timelineStatus).toBe('inprogress');
    expect(courses.find((c) => c.id === 2)?.timelineStatus).toBe('past');
    expect(courses.find((c) => c.id === 3)?.timelineStatus).toBe('past');
  });

  it('resolves session context once and reuses it for course fetches', async () => {
    const upstreamMock = {
      getContext: jest.fn().mockResolvedValue({ cookie: 'c1', sesskey: 'sk1' }),
      checkSessionValid: jest.fn(),
      ajax: jest.fn(),
      fetchSesskeyOrThrow: jest.fn().mockResolvedValue('sk1'),
    };
    upstreamMock.getContext = jest
      .fn()
      .mockResolvedValue({ cookie: 'c1', sesskey: 'sk1' });
    upstreamMock.ajax
      .mockResolvedValueOnce({ courses: [] }) // classification 'all'
      .mockResolvedValueOnce({ courses: [] }) // 'inprogress'
      .mockResolvedValueOnce({ courses: [] }); // 'hidden'
    const service = new KulonService(
      undefined,
      undefined,
      upstreamMock as any,
      undefined,
    );
    await service.getCourses('2304012012345');
    expect(upstreamMock.getContext).toHaveBeenCalledTimes(1);
  });

  it('getAllAssignments uses renamed key + 3-min TTL', async () => {
    const setSpy = jest.fn();
    const cacheMock = {
      get: jest.fn().mockResolvedValue(null),
      set: setSpy,
      del: jest.fn(),
    };
    const upstreamMock = {
      getContext: jest.fn().mockResolvedValue({ cookie: 'c1', sesskey: 'sk1' }),
      ajax: jest.fn().mockResolvedValue({ courses: [] }),
    };
    const service = new KulonService(
      cacheMock as any,
      undefined,
      upstreamMock as any,
      undefined,
    );
    await service.getAllAssignments('2304012012345');
    expect(setSpy).toHaveBeenCalledWith(
      '2304012012345:kulon:assignments:all',
      expect.anything(),
      180_000,
    );
  });

  it('getAllAssignments passes withProgress:false to the courses fetch', async () => {
    const cacheMock = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      del: jest.fn(),
    };
    const upstreamMock = {
      getContext: jest.fn().mockResolvedValue({ cookie: 'c1', sesskey: 'sk1' }),
      ajax: jest.fn().mockResolvedValue({ courses: [] }),
    };
    const svc = new KulonService(
      cacheMock as any,
      undefined,
      upstreamMock as any,
      undefined,
    );
    const spy = jest.spyOn(svc as any, 'fetchCourses');
    await svc.getAllAssignments('u1');
    expect(spy).toHaveBeenCalledWith(
      'c1',
      'sk1',
      'u1',
      { withLecturers: false, withProgress: false },
    );
    spy.mockRestore();
  });

  it('fetchCourses with withProgress:false skips progress scrape and does NOT write cache on miss', async () => {
    const setSpy = jest.fn();
    const cacheMock = {
      get: jest.fn().mockResolvedValue(null), // cold miss
      set: setSpy,
      del: jest.fn(),
    };
    const upstreamMock = {
      getContext: jest.fn().mockResolvedValue({ cookie: 'c1', sesskey: 'sk1' }),
      ajax: jest
        .fn()
        // timeline 'all' / 'inprogress' / 'hidden' each resolve an empty course list
        .mockResolvedValue({ courses: [] }),
    };
    const svc = new KulonService(
      cacheMock as any,
      undefined,
      upstreamMock as any,
      undefined,
    );
    const progressSpy = jest.spyOn(svc as any, 'fetchCourseContent');
    await svc.getAllAssignments('u1');
    expect(progressSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalledWith('u1:kulon:courses', expect.anything());
    // assignments:all still written (existing behavior)
    expect(setSpy).toHaveBeenCalledWith('u1:kulon:assignments:all', expect.anything(), 180_000);
    progressSpy.mockRestore();
  });

  it('fetchCourses with withProgress:false on cache HIT returns cached data without upstream fetch', async () => {
    const cached = [
      { id: 1, fullname: 'X', shortname: 'M1', idnumber: '', timelineStatus: 'inprogress', progress: 50 },
    ];
    // getAllAssignments checks its OWN `assignments:all` cache first — that must
    // miss (null) so the flow reaches fetchCourses, whose `courses` cache hit
    // (cached) is what this test exercises. (Adapted: plan's flat mockResolvedValue
    // would make the assignments:all check hit and return the course array early.)
    const getSpy = jest
      .fn()
      .mockImplementation(async (key: string) =>
        key.endsWith(':assignments:all') ? null : cached,
      );
    const setSpy = jest.fn();
    const upstreamMock = {
      getContext: jest.fn().mockResolvedValue({ cookie: 'c1', sesskey: 'sk1' }),
      ajax: jest.fn().mockResolvedValue({ courses: [] }),
    };
    const svc = new KulonService(
      { get: getSpy, set: setSpy, del: jest.fn() } as any,
      undefined,
      upstreamMock as any,
      undefined,
    );
    // getAllAssignments will loop the cached course through fetchAssignmentIndex /
    // fetchQuizIndex (global.fetch). Mock it so the loop settles deterministically
    // instead of relying on fetchAssignmentIndex's error-swallowing catch.
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as any;
    const out = await svc.getAllAssignments('u1');
    expect(getSpy).toHaveBeenCalledWith('u1:kulon:courses');
    expect(upstreamMock.ajax).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalledWith('u1:kulon:courses', expect.anything());
    expect(out).toEqual([]);
  });

  it('public getCourses (no opts) still writes cache with progress', async () => {
    const cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() };
    const siapFake = { getLecturers: jest.fn().mockResolvedValue([{ kode: 'M1', dosen: 'Dr. X' }]) };
    const svcNew = makeAuthedKulonSvc({ cache, siap: siapFake });
    svcNew.fetchTimelineCourses = jest.fn().mockResolvedValue([
      { id: 1, fullname: 'Matkul', shortname: 'M1', idnumber: '', timelineStatus: 'inprogress' },
    ]) as any;
    (svcNew as any).fetchCourseContent = jest.fn().mockResolvedValue({ sections: [] }) as any;
    await svcNew.getCourses('u1');
    expect(cache.set).toHaveBeenCalledWith('u1:kulon:courses', expect.anything());
  });

  it('getAllAssignments single-flights concurrent callers (1 upstream run)', async () => {
    const upstreamMock = {
      getContext: jest.fn().mockResolvedValue({ cookie: 'c1', sesskey: 'sk1' }),
      ajax: jest.fn().mockResolvedValue({ courses: [] }),
    };
    const service = new KulonService(
      undefined,
      undefined,
      upstreamMock as any,
      undefined,
    );
    await Promise.all([
      service.getAllAssignments('S1'),
      service.getAllAssignments('S1'),
      service.getAllAssignments('S1'),
    ]);
    // One allAssignmentsFlight run for the whole burst: the upstream run
    // (getContext) happens exactly once, not once per caller.
    expect(upstreamMock.getContext).toHaveBeenCalledTimes(1);
  });

  it('getCourses single-flights concurrent callers per sub', async () => {
    const upstreamMock = {
      getContext: jest.fn().mockResolvedValue({ cookie: 'c1', sesskey: 'sk1' }),
      ajax: jest.fn().mockResolvedValue({ courses: [] }),
    };
    const service = new KulonService(
      undefined,
      undefined,
      upstreamMock as any,
      undefined,
    );
    await Promise.all([
      service.getCourses('S1'),
      service.getCourses('S1'),
      service.getCourses('S2'),
    ]);
    // getContext called once for S1, once for S2 (3 timeline fetches each)
    expect(upstreamMock.getContext).toHaveBeenCalledTimes(2);
  });

  it('getCourses allows a fresh run after completion (keyed map cleaned)', async () => {
    const upstreamMock = {
      getContext: jest.fn().mockResolvedValue({ cookie: 'c1', sesskey: 'sk1' }),
      ajax: jest.fn().mockResolvedValue({ courses: [] }),
    };
    const service = new KulonService(
      undefined,
      undefined,
      upstreamMock as any,
      undefined,
    );
    await service.getCourses('S1');
    await service.getCourses('S1'); // sequential — NOT concurrent
    expect(upstreamMock.getContext).toHaveBeenCalledTimes(2);
  });

  it('gets courses with semester extracted from fullname', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { error: false, data: { courses: [{ id: 1, fullname: 'S1 2025/2026 Genap Kripto', shortname: 'K', idnumber: '' }] } },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ error: false, data: { courses: [] } }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ error: false, data: { courses: [] } }],
      })
      // post-timeline content scrape (course id 1): getCourseContent is now
      // JSON-first, so the first content fetch is the service.php JSON attempt
      // (no json() -> TypeError -> HTML fallback), the second is the /course/view.php scrape.
      .mockResolvedValueOnce({ ok: true, text: async () => '' })
      .mockResolvedValueOnce({ ok: true, text: async () => '<html></html>' });
    const courses = await svc.getCourses('u1');
    expect(courses[0].semester).toBe('2025/2026 Genap');
    // not present in the 'inprogress' bucket -> past
    expect(courses[0].timelineStatus).toBe('past');
  });

  it('gets courses with a future-month progress of 0', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            error: false,
            data: {
              courses: [{ id: 1, fullname: 'Course A', shortname: 'CA', idnumber: '1' }],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { error: false, data: { courses: [{ id: 1, fullname: 'Course A', shortname: 'CA', idnumber: '1' }] } },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ error: false, data: { courses: [] } }],
      })
      // post-timeline content scrape: both dated sections end in a future month
      // relative to any run date -> progress 0. getCourseContent is JSON-first,
      // so first content fetch = service.php JSON attempt (no json() -> TypeError
      // -> HTML fallback), second = /course/view.php scrape.
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<li id="section-0" data-sectionname="General"></li>' +
          '<li id="section-1" data-sectionname="1 November - 8 November"></li>' +
          '<li id="section-2" data-sectionname="15 November - 22 November"></li>',
      });
    const courses = await svc.getCourses('u1');
    expect(courses.find((c) => c.id === 1)?.progress).toBe(0);
  });

  it('gets assignments with deadlines from calendar endpoint', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          error: false,
          data: {
            events: [
              {
                id: 1165,
                activityname: 'Tugas Kelompok I',
                modulename: 'assign',
                eventtype: 'due',
                timestart: 1742230800,
                overdue: true,
                course: { id: 9371, fullname: 'Metode Numerik D' },
              },
            ],
          },
        },
      ],
    });
    const assignments = await svc.getAssignments('u1');
    expect(assignments[0].name).toBe('Tugas Kelompok I');
    expect(assignments[0].duedate).toBe(1742230800);
    expect(assignments[0].course).toBe('Metode Numerik D');
    expect(assignments[0].overdue).toBe(true);
  });

  it('extracts sesskey from page html', async () => {
    const html = `<form><input type="hidden" name="sesskey" value="abc123XYZ"></form>`;
    const key = svc.parseSesskey(html);
    expect(key).toBe('abc123XYZ');
  });

  it('maps assignmentId and courseModuleId into assignments list', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          error: false,
          data: {
            events: [
              {
                id: 1165,
                activityname: 'Tugas Kelompok I',
                modulename: 'assign',
                eventtype: 'due',
                timestart: 1742230800,
                overdue: true,
                instance: 42,
                url: 'https://kulon2.undip.ac.id/mod/assign/view.php?id=777',
                course: { id: 9371, fullname: 'C' },
              },
            ],
          },
        },
      ],
    });
    const assignments = await svc.getAssignments('u1');
    expect(assignments[0].assignmentId).toBe(42);
    expect(assignments[0].courseModuleId).toBe(777);
  });

  it('derives courseModuleId from the event url (no extra AJAX call)', async () => {
    // Real Kulon events carry NO cmid field; the page id lives in event.url.
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          error: false,
          data: {
            events: [
              {
                id: 1165,
                activityname: 'Tugas Kelompok I',
                modulename: 'assign',
                eventtype: 'due',
                timestart: 1742230800,
                overdue: true,
                instance: 42,
                url: 'https://kulon2.undip.ac.id/mod/assign/view.php?id=3335',
                course: { id: 9371, fullname: 'C' },
              },
            ],
          },
        },
      ],
    });
    const assignments = await svc.getAssignments('u1');
    expect(assignments[0].courseModuleId).toBe(3335);
    // Exactly one fetch: the calendar AJAX. No course-module lookup call.
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('returns courseModuleId 0 when event url does not match an assign page', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          error: false,
          data: {
            events: [
              {
                id: 1165,
                activityname: 'Quiz A',
                modulename: 'quiz',
                eventtype: 'due',
                timestart: 1742230800,
                overdue: false,
                instance: 9,
                url: 'https://kulon2.undip.ac.id/mod/quiz/view.php?id=9',
                course: { id: 9371, fullname: 'C' },
              },
            ],
          },
        },
      ],
    });
    const assignments = await svc.getAssignments('u1');
    expect(assignments[0].courseModuleId).toBe(0);
  });

  it('fetches assignment detail and parses a graded submission from HTML', async () => {
    const pageHtml =
      '<header id="page-header"><div class="page-context-header"><h1>Tugas Kelompok I</h1></div></header>' +
      '<div class="activity-description" id="intro"><div class="box py-3 generalbox boxaligncenter"><div class="no-overflow"><p>Kerjakan laporan kelompok.</p></div></div></div>' +
      '<div class="submissionstatustable"><h3>Submission status</h3><div class="box py-3 boxaligncenter submissionsummarytable">' +
      '<div class="table-responsive"><table class="generaltable table-bordered"><tbody>' +
      '<tr><th class="cell c0" scope="row">Submission status</th><td class="submissionstatussubmitted cell c1 lastcol">Submitted for grading</td></tr>' +
      '<tr><th class="cell c0" scope="row">Grading status</th><td class="submissiongraded cell c1 lastcol">Graded</td></tr>' +
      '<tr><th class="cell c0" scope="row">Grade</th><td class="cell c1 lastcol">85.00 / 100.00</td></tr>' +
      '<tr><th class="cell c0" scope="row">Last modified</th><td class="cell c1 lastcol">Thursday, 7 May 2026, 11:50 PM</td></tr>' +
      '</tbody></table></div></div></div>';
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: async () => pageHtml,
    });
    const detail = await svc.getAssignmentDetail('u1', 42, 777);
    expect(detail.assignmentId).toBe(42);
    expect(detail.name).toBe('Tugas Kelompok I');
    expect(detail.descriptionHtml).toContain('Kerjakan laporan kelompok.');
    expect(detail.descriptionMarkdown).toBe('Kerjakan laporan kelompok.');
    expect(detail.submission.status).toBe('graded');
    expect(detail.submission.grade).toBe(85);
    expect(detail.submission.maxGrade).toBe(100);
    expect(detail.submission.submittedAt).toBe(1778172600); // 7 May 2026 11:50 PM WIB
    expect(detail.kulonUrl).toContain('view.php?id=777');
  });

  it('parses submitted + not graded submission (verified live shape)', async () => {
    const pageHtml =
      '<header id="page-header"><h1>Task</h1></header>' +
      '<div class="submissionstatustable"><h3>Submission status</h3><div class="box py-3 boxaligncenter submissionsummarytable">' +
      '<div class="table-responsive"><table class="generaltable table-bordered"><tbody>' +
      '<tr><th class="cell c0" scope="row">Submission status</th><td class="submissionstatussubmitted cell c1 lastcol">Submitted for grading</td></tr>' +
      '<tr><th class="cell c0" scope="row">Grading status</th><td class="submissionnotgraded cell c1 lastcol">Not graded</td></tr>' +
      '<tr><th class="cell c0" scope="row">Last modified</th><td class="cell c1 lastcol">Thursday, 7 May 2026, 11:50 PM</td></tr>' +
      '<tr><th class="cell c0" scope="row">File submissions</th><td class="cell c1 lastcol"><div class="fileuploadsubmission"><a href="https://kulon2.undip.ac.id/pluginfile.php/484704/assignsubmission_file/submission_files/595020/x.pdf">x.pdf</a></div></td></tr>' +
      '</tbody></table></div></div></div>';
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: async () => pageHtml,
    });
    const detail = await svc.getAssignmentDetail('u1', 42, 777);
    expect(detail.submission.status).toBe('submitted');
    expect(detail.submission.grade).toBeNull();
    expect(detail.submission.maxGrade).toBeNull();
    expect(detail.submission.submittedAt).toBe(1778172600); // 7 May 2026 11:50 PM WIB
    expect(detail.files.some((f) => f.name === 'x.pdf')).toBe(true);
  });

  it('returns not_submitted when submission status says not submitted', async () => {
    const pageHtml =
      '<header id="page-header"><h1>Task</h1></header>' +
      '<div class="activity-description" id="intro"><div class="no-overflow"></div></div>' +
      '<div class="submissionstatustable"><h3>Submission status</h3><div class="box py-3 boxaligncenter submissionsummarytable">' +
      '<div class="table-responsive"><table class="generaltable table-bordered"><tbody>' +
      '<tr><th class="cell c0" scope="row">Submission status</th><td class="submissionstatusnotsubmitted cell c1 lastcol">Not submitted</td></tr>' +
      '<tr><th class="cell c0" scope="row">Grading status</th><td class="submissionnotgraded cell c1 lastcol">Not graded</td></tr>' +
      '</tbody></table></div></div></div>';
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: async () => pageHtml,
    });
    const detail = await svc.getAssignmentDetail('u1', 42, 777);
    expect(detail.name).toBe('Task');
    expect(detail.descriptionHtml).toBe('');
    expect(detail.submission.status).toBe('not_submitted');
    expect(detail.submission.grade).toBeNull();
    expect(detail.submission.maxGrade).toBeNull();
    expect(detail.submission.submittedAt).toBeUndefined();
  });

  it('returns not_submitted for real Moodle phrasing "No submissions have been made yet"', async () => {
    // Verified live: Moodle renders not-submitted WITHOUT a status class on the
    // td and with the text "No submissions have been made yet" (not "Not submitted").
    const pageHtml =
      '<header id="page-header"><h1>Task</h1></header>' +
      '<div class="submissionstatustable"><h3>Submission status</h3><div class="box py-3 boxaligncenter submissionsummarytable">' +
      '<div class="table-responsive"><table class="generaltable table-bordered"><tbody>' +
      '<tr class=""><th class="cell c0" style="" scope="row">Submission status</th><td class="cell c1 lastcol" style="">No submissions have been made yet</td></tr>' +
      '<tr class=""><th class="cell c0" style="" scope="row">Grading status</th><td class="submissionnotgraded cell c1 lastcol" style="">Not graded</td></tr>' +
      '<tr class=""><th class="cell c0" style="" scope="row">Last modified</th><td class="cell c1 lastcol" style="">-</td></tr>' +
      '</tbody></table></div></div></div>';
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: async () => pageHtml,
    });
    const detail = await svc.getAssignmentDetail('u1', 42, 777);
    expect(detail.submission.status).toBe('not_submitted');
    expect(detail.submission.grade).toBeNull();
    expect(detail.submission.maxGrade).toBeNull();
    expect(detail.submission.submittedAt).toBeUndefined();
  });

  it('returns unknown submission when page has no submissionstatustable', async () => {
    const pageHtml =
      '<header id="page-header"><h1>Task</h1></header><div id="intro"><div class="no-overflow"></div></div>';
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: async () => pageHtml,
    });
    const detail = await svc.getAssignmentDetail('u1', 42, 777);
    expect(detail.submission.status).toBe('unknown');
    expect(detail.submission.grade).toBeNull();
    expect(detail.submission.maxGrade).toBeNull();
  });

  it('throws ASSIGNMENT_NOT_FOUND when page responds 404', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 404,
    });
    await expect(
      svc.getAssignmentDetail('u1', 42, 777),
    ).rejects.toThrow('ASSIGNMENT_NOT_FOUND');
  });

  describe('parseAssignmentIndex', () => {
    const indexHtml =
      '<table class="generaltable"><thead><tr><th>Section</th><th>Assignments</th><th>Due date</th><th>Submission</th><th>Grade</th></tr></thead><tbody>' +
      '<tr><td class="cell c0">Pertemuan Kedua</td><td class="cell c1"><a href="https://kulon2.undip.ac.id/mod/assign/view.php?id=3317">Tugas Kelompok I. Galat</a></td><td class="cell c2">Tuesday, 18 March 2025, 12:00 AM</td><td class="cell c3">No submission</td><td class="cell c4 lastcol">-</td></tr>' +
      '<tr><td class="cell c0"></td><td class="cell c1"><a href="https://kulon2.undip.ac.id/mod/assign/view.php?id=3342">Tugas Individu I. Galat</a></td><td class="cell c2">Thursday, 7 May 2027, 11:50 PM</td><td class="cell c3">Submitted for grading</td><td class="cell c4 lastcol">-</td></tr>' +
      '<tr><td class="cell c0"></td><td class="cell c1"><a href="https://kulon2.undip.ac.id/mod/assign/view.php?id=9999">Tugas Dinilai</a></td><td class="cell c2">Monday, 2 June 2025, 8:00 AM</td><td class="cell c3">Graded</td><td class="cell c4 lastcol">85.00</td></tr>' +
      '</tbody></table>';

    it('parses each row into a KulonAssignment with submission status', () => {
      const rows = parseAssignmentIndex(indexHtml, 9371, 'Struktur Diskret D');
      expect(rows).toHaveLength(3);

      const [notSub, submitted, graded] = rows;
      expect(notSub.name).toBe('Tugas Kelompok I. Galat');
      expect(notSub.courseModuleId).toBe(3317);
      expect(notSub.assignmentId).toBe(3317);
      expect(notSub.courseId).toBe(9371);
      expect(notSub.course).toBe('Struktur Diskret D');
      expect(notSub.submissionStatus).toBe('not_submitted');
      expect(notSub.overdue).toBe(true); // due March 2025

      expect(submitted.name).toBe('Tugas Individu I. Galat');
      expect(submitted.submissionStatus).toBe('submitted');
      expect(submitted.overdue).toBe(false); // due May 2026

      expect(graded.submissionStatus).toBe('graded');
    });

    it('returns empty when page has no mod-index table', () => {
      const rows = parseAssignmentIndex('<html>no table</html>', 1, 'C');
      expect(rows).toEqual([]);
    });
  });

  describe('parseQuizIndex', () => {
    // Real Kulon (moove) structure: c0 Week, c1 Name(link, RELATIVE view.php),
    // c2 Quiz closes, c3 Grade.
    const quizHtml =
      '<table class="generaltable">' +
      '<tr><td class="cell c0">2 March - 8 March</td><td class="cell c1"><a href="view.php?id=114796">quis 4</a></td><td class="cell c2">No close date</td><td class="cell c3 lastcol">-</td></tr>' +
      '<tr><td class="cell c0"></td><td class="cell c1"><a href="view.php?id=108786">Quis 3</a></td><td class="cell c2">Thursday, 19 February 2026, 9:20 AM</td><td class="cell c3 lastcol">60.00/100.00</td></tr>' +
      '<tr><td class="cell c0"></td><td class="cell c1"><a href="view.php?id=99999">Quis Future</a></td><td class="cell c2">Monday, 1 December 2030, 11:59 PM</td><td class="cell c3 lastcol">-</td></tr>' +
      '</table>';

    it('parses quiz rows from relative links (module: quiz, closes from c2)', () => {
      const rows = parseQuizIndex(quizHtml, 15452, 'Analisis dan Strategi Algoritma E');
      expect(rows).toHaveLength(3);
      const [noLimit, past, future] = rows;
      expect(noLimit.name).toBe('quis 4');
      expect(noLimit.module).toBe('quiz');
      expect(noLimit.courseModuleId).toBe(114796);
      expect(noLimit.overdue).toBe(false); // No close date
      expect(noLimit.duedate).toBe(0); // no deadline sentinel

      expect(past.name).toBe('Quis 3');
      expect(past.courseModuleId).toBe(108786);
      expect(past.overdue).toBe(true); // Feb 2026 is in the past

      expect(future.name).toBe('Quis Future');
      expect(future.overdue).toBe(false); // Dec 2030
    });

    it('returns empty when page has no quiz table', () => {
      const rows = parseQuizIndex('<html>no table</html>', 1, 'C');
      expect(rows).toEqual([]);
    });
  });

  describe('checkSessionValid', () => {
    it('returns valid ok when /my/ has a sesskey', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://kulon2.undip.ac.id/my/',
        text: async () => '<input type="hidden" name="sesskey" value="abc">',
      });
      const res = await svc.checkSessionValid('MoodleSession=K');
      expect(res).toEqual({ valid: true, reason: 'ok' });
    });

    it('returns no-cookie when cookie is empty', async () => {
      const res = await svc.checkSessionValid('');
      expect(res).toEqual({ valid: false, reason: 'no-cookie' });
    });

    it('returns stale when final URL is a login page', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://kulon2.undip.ac.id/login/index.php',
        text: async () => '<html>login</html>',
      });
      const res = await svc.checkSessionValid('MoodleSession=STALE');
      expect(res).toEqual({ valid: false, reason: 'stale' });
    });

    it('returns stale when redirecting to microsoft login', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://login.microsoftonline.com/...',
        text: async () => '<html>sign in</html>',
      });
      const res = await svc.checkSessionValid('MoodleSession=STALE');
      expect(res).toEqual({ valid: false, reason: 'stale' });
    });

    it('returns stale when fetch fails (redirect loop)', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), { cause: new Error('redirect count exceeded') }),
      );
      const res = await svc.checkSessionValid('MoodleSession=STALE');
      expect(res).toEqual({ valid: false, reason: 'stale' });
    });

    it('returns stale when page has no sesskey', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://kulon2.undip.ac.id/my/',
        text: async () => '<html>no sesskey here</html>',
      });
      const res = await svc.checkSessionValid('MoodleSession=STALE');
      expect(res).toEqual({ valid: false, reason: 'stale' });
    });
  });

  describe('getSessionIdentity', () => {
    it('returns the username (NIM) from core_webservice_get_site_info', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          url: 'https://kulon2.undip.ac.id/my/',
          text: async () => '<input type="hidden" name="sesskey" value="sess123">',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ error: false, data: { username: '24060121130000' } }],
        });
      const id = await svc.getSessionIdentity('MoodleSession=K');
      expect(id).toBe('24060121130000');
    });

    it('returns null when /my/ has no sesskey (stale session)', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        url: 'https://kulon2.undip.ac.id/my/',
        text: async () => '<html>login page</html>',
      });
      const id = await svc.getSessionIdentity('MoodleSession=STALE');
      expect(id).toBeNull();
    });

    it('returns null when session cookie is empty', async () => {
      const id = await svc.getSessionIdentity('');
      expect(id).toBeNull();
    });

    it('returns null when the ajax call errors', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          url: 'https://kulon2.undip.ac.id/my/',
          text: async () => '<input type="hidden" name="sesskey" value="sess123">',
        })
        .mockRejectedValueOnce(new Error('network'));
      const id = await svc.getSessionIdentity('MoodleSession=K');
      expect(id).toBeNull();
    });

    it('falls back to scraping NIM from /user/profile.php when site_info is disabled', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          url: 'https://kulon2.undip.ac.id/my/',
          text: async () => '<input type="hidden" name="sesskey" value="sess123">',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ error: true, exception: { message: "Web service is not available. (It doesn't exist or might be disabled.)" } }],
        })
        .mockResolvedValueOnce({
          ok: true,
          url: 'https://kulon2.undip.ac.id/user/profile.php',
          text: async () => '<head><title>Muhamad Kemal Faza 24060124120013: Public profile</title></head>',
        });
      const id = await svc.getSessionIdentity('MoodleSession=K');
      expect(id).toBe('24060124120013');
    });

    it('prefers the NIM that precedes ": Public profile" when other 8+ digit numbers appear (B13)', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          url: 'https://kulon2.undip.ac.id/my/',
          text: async () => '<input type="hidden" name="sesskey" value="sess123">',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ error: true, exception: { message: 'disabled' } }],
        })
        .mockResolvedValueOnce({
          ok: true,
          url: 'https://kulon2.undip.ac.id/user/profile.php',
          // A phone/NIK-like number appears first; the NIM is right before the colon.
          text: async () => '<head><title>089693048519 Muhamad Kemal Faza 24060124120013: Public profile</title></head>',
        });
      const id = await svc.getSessionIdentity('MoodleSession=K');
      expect(id).toBe('24060124120013');
    });

    it('returns null when profile page has no NIM in title', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          url: 'https://kulon2.undip.ac.id/my/',
          text: async () => '<input type="hidden" name="sesskey" value="sess123">',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ error: true, exception: { message: 'disabled' } }],
        })
        .mockResolvedValueOnce({
          ok: true,
          url: 'https://kulon2.undip.ac.id/user/profile.php',
          text: async () => '<head><title>Public profile</title></head>',
        });
      const id = await svc.getSessionIdentity('MoodleSession=K');
      expect(id).toBeNull();
    });
  });

  it('getCourses caches and reuses cached output per user, including lecturer merge', async () => {
    const cache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    const svcNew = makeAuthedKulonSvc({ cache });
    cache.get.mockResolvedValue([{ id: 1, fullname: 'X', shortname: 'M1', idnumber: '', timelineStatus: 'inprogress' }]);
    const out = await svcNew.getCourses('u1');
    expect(cache.get).toHaveBeenCalledWith('u1:kulon:courses');
    expect(out).toHaveLength(1);
  });

  it('getCourses on cache miss scrapes, merges lecturers, and caches the merged list', async () => {
    global.fetch = jest.fn();
    const cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() };
    const siapFake = { getLecturers: jest.fn().mockResolvedValue([{ kode: 'MIK1624105', dosen: 'Dr. X' }]) };
    const svcNew = makeAuthedKulonSvc({ cache, siap: siapFake });
    svcNew.fetchTimelineCourses = jest.fn().mockResolvedValue([
      { id: 1, fullname: 'Matkul', shortname: 'MIK1624105', idnumber: '', timelineStatus: 'inprogress' },
    ]) as any;
    (svcNew as any).fetchCourseContent = jest.fn().mockResolvedValue({ sections: [] }) as any;
    const out = await svcNew.getCourses('u1');
    expect(cache.set).toHaveBeenCalledWith('u1:kulon:courses', expect.arrayContaining([
      expect.objectContaining({ lecturer: 'Dr. X' }),
    ]));
    expect(siapFake.getLecturers).toHaveBeenCalledWith('u1');
  });
});

describe('parseMoodleDate (B8 - WIB timezone)', () => {
  let svc: KulonService;
  beforeEach(() => {
    svc = new KulonService();
  });

  it('interprets Moodle timestamps as WIB (UTC+7) regardless of server timezone', () => {
    // "Thursday, 7 May 2026, 11:50 PM" rendered by Moodle in WIB (UTC+7).
    // WIB-23:50 == UTC-16:50 on the same day. Expected epoch (seconds):
    // Date.UTC(2026,4,7,16,50) = 1778172600.
    const parsed = parseMoodleDate(
      'Thursday, 7 May 2026, 11:50 PM',
    );
    expect(parsed).toBe(1778172600);
  });

  it('returns null for an empty value', () => {
    expect(parseMoodleDate('')).toBe(null);
  });

  it('returns null for a malformed value', () => {
    expect(parseMoodleDate('nonsense')).toBe(null);
  });
});

describe('getCourseState', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('maps core_courseformat_get_state JSON into sections/items', async () => {
    const svc = new KulonService();
    const state = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '../../test/fixtures/kulon/courseformat-state.json'),
        'utf8',
      ),
    );
    // Mock this.ajax by mocking global.fetch: ajax() POSTs to service.php and calls res.json().
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://kulon2.undip.ac.id/lib/ajax/service.php?sesskey=sk',
      json: async () => [
        { error: false, data: state },
      ],
    });
    // getCourseState is private -> access via (svc as any), matching existing spec pattern.
    const content = await (svc as any).getCourseState('cookie', 'sk', 15452);
    expect(content.courseId).toBe(15452);
    // Section 0 = General (forum Announcements + file kontrak).
    const gen = content.sections.find((s) => s.id === 0);
    expect(gen?.label).toBe('General');
    expect(gen?.items.map((i) => i.kind)).toEqual(['forum', 'file']);
    // Section ordinal 1: date-range title -> Pertemuan 1 + dateRange; file + quiz.
    const s1 = content.sections.find((s) => s.id === 1);
    expect(s1?.label).toBe('Pertemuan 1');
    expect(s1?.dateRange).toBe('9 February - 15 February');
    const fileItem = s1?.items.find((i) => i.kind === 'file');
    expect(fileItem?.fileType).toBe('other'); // no f/<type> or extension in fixture url
    expect(s1?.items.map((i) => i.kind).sort()).toEqual(['file', 'quiz']);
    // Section 12: custom title preserved; assign kept.
    const s12 = content.sections.find((s) => s.id === 12);
    expect(s12?.label).toBe('Pertemuan 11 - Branch and Bound');
    const assignItem = s12?.items.find((i) => i.kind === 'assign');
    expect(assignItem?.name).toBe('Tugas BnB');
    expect(assignItem?.cmid).toBe(128341);
    // Stealth + uservisible:false resource cm (128338) is excluded by the inclusion
    // rule (uservisible:false, module=resource). 126796 is also absent, but that is
    // because its sectionnumber 11 has no matching section in the fixture (dropped by
    // the owner lookup) — the uservisible rule is genuinely exercised by 128338.
    const allCmid = content.sections.flatMap((s) => s.items.map((i) => i.cmid));
    expect(allCmid).not.toContain(126796);
    expect(allCmid).not.toContain(128338);
    expect(allCmid).toContain(105222); // quiz, kept via module exception
  });
});