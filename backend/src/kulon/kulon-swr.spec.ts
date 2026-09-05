import 'reflect-metadata';
import type { DataCache } from '../cache/data-cache';
import { KulonService } from './kulon.service';
import type { KulonUpstreamSession } from './kulon-upstream.session';
import type { KulonCourse, KulonCourseContent } from './kulon-parse';

type CacheMock = {
  get: jest.Mock;
  getStale: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
};

type UpstreamMock = {
  getContext: jest.Mock;
  getContextForSession: jest.Mock;
  getContextForCurrent: jest.Mock;
  ajax: jest.Mock;
};

type TimelineArgs = {
  classification?: string;
};

type KulonServiceInternals = {
  fetchCourseContent: (
    cookie: string,
    sesskey: string,
    courseId: number,
    sub?: string,
  ) => Promise<KulonCourseContent>;
  fetchCourses: (
    cookie: string,
    sesskey: string,
    sub?: string,
    opts?: { withLecturers?: boolean; withProgress?: boolean },
  ) => Promise<KulonCourse[]>;
};

function internals(service: KulonService): KulonServiceInternals {
  return service as unknown as KulonServiceInternals;
}

function makeCache(): CacheMock {
  return {
    get: jest.fn(),
    getStale: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };
}

const TEST_GEN = 'a'.repeat(32);
const ref = (sub: string) => ({ sub, sessionGeneration: TEST_GEN });

function makeUpstream(): UpstreamMock {
  const canned = { cookie: 'cookie', sesskey: 'sesskey' };
  return {
    getContext: jest
      .fn()
      .mockResolvedValue(canned),
    getContextForSession: jest.fn().mockResolvedValue(canned),
    getContextForCurrent: jest.fn().mockResolvedValue(canned),
    ajax: jest
      .fn()
      .mockImplementation(
        (
          _cookie: string,
          _sesskey: string,
          method: string,
          args: TimelineArgs,
        ) => {
          if (
            method ===
            'core_course_get_enrolled_courses_by_timeline_classification'
          ) {
            return Promise.resolve({
              courses:
                args.classification === 'all'
                  ? [
                      {
                        id: 1,
                        fullname: 'S1 2026/2027 Ganjil Course',
                        shortname: 'C1',
                        idnumber: '',
                      },
                    ]
                  : [],
            });
          }
          return Promise.reject(
            new Error(`unexpected upstream method: ${method}`),
          );
        },
      ),
  };
}

const cachedCourses: KulonCourse[] = [
  {
    id: 99,
    fullname: 'Cached course',
    shortname: 'CACHED',
    idnumber: '',
    timelineStatus: 'past',
  },
];

describe('KulonService SWR course refresh', () => {
  it('bypasses the same payload cache during getCourses refresh', async () => {
    const cache = makeCache();
    cache.get.mockResolvedValue(cachedCourses);
    cache.getStale.mockImplementation(
      async (_key: string, fetcher: () => Promise<KulonCourse[]>) => ({
        value: await fetcher(),
        stale: true,
      }),
    );
    const upstream = makeUpstream();
    const service = new KulonService(
      cache as unknown as DataCache,
      undefined,
      upstream as unknown as KulonUpstreamSession,
    );
    internals(service).fetchCourseContent = () =>
      Promise.resolve({ courseId: 1, sections: [] });

    const result = await service.getCourses(ref('u1'));

    expect(result[0]?.id).toBe(1);
    const staleCalls = cache.getStale.mock.calls as unknown as Array<
      [
        string,
        () => Promise<KulonCourse[]>,
        { freshTtlMs: number; staleTtlMs: number },
      ]
    >;
    expect(staleCalls[0]?.[0]).toBe('u1:kulon:courses');
    expect(staleCalls[0]?.[2].freshTtlMs).toBeGreaterThan(0);
    expect(cache.get).not.toHaveBeenCalledWith('u1:kulon:courses');
    expect(upstream.ajax).toHaveBeenCalledWith(
      'cookie',
      'sesskey',
      'core_course_get_enrolled_courses_by_timeline_classification',
      expect.objectContaining({ classification: 'all' }),
    );
  });

  it('keeps internal course-cache reuse for assignments aggregation', async () => {
    const cache = makeCache();
    cache.get.mockResolvedValue(cachedCourses);
    const upstream = makeUpstream();
    const service = new KulonService(
      cache as unknown as DataCache,
      undefined,
      upstream as unknown as KulonUpstreamSession,
    );

    const result = await internals(service).fetchCourses(
      'cookie',
      'sesskey',
      'u1',
      { withProgress: false, withLecturers: false },
    );

    expect(result).toEqual(cachedCourses);
    expect(cache.get).toHaveBeenCalledWith('u1:kulon:courses');
    expect(upstream.ajax).not.toHaveBeenCalled();
  });

  it('uses getStale as the sole payload writer for all four Kulon families', async () => {
    const cases: Array<{
      key: string;
      run: (service: KulonService) => Promise<unknown>;
      prepare?: (service: KulonService, upstream: UpstreamMock) => void;
    }> = [
      {
        key: 'u1:kulon:courses',
        run: (service) => service.getCourses(ref('u1')),
      },
      {
        key: 'u1:kulon:assignments:all',
        run: (service) => service.getAllAssignments(ref('u1')),
        prepare: (_service, upstream) => {
          upstream.ajax.mockResolvedValue({ courses: [] });
        },
      },
      {
        key: 'u1:kulon:assignment-detail:7',
        run: (service) => service.getAssignmentDetail(ref('u1'), 9, 7),
      },
      {
        key: 'u1:kulon:course-content:7',
        run: (service) => service.getCourseContent(ref('u1'), 7),
      },
    ];

    for (const testCase of cases) {
      const cache = makeCache();
      const upstream = makeUpstream();
      const service = new KulonService(
        cache as unknown as DataCache,
        undefined,
        upstream as unknown as KulonUpstreamSession,
      );
      cache.getStale.mockImplementation(
        async (key: string, fetcher: () => Promise<unknown>) => {
          const value = await fetcher();
          await cache.set(key, value);
          return { value, stale: false };
        },
      );
      const fetchMock = jest.fn();
      global.fetch = fetchMock as any;
      if (testCase.prepare) testCase.prepare(service, upstream);
      if (testCase.key.includes('assignment-detail')) {
        fetchMock.mockResolvedValue({
          ok: true,
          status: 200,
          url: 'https://kulon2.undip.ac.id/mod/assign/view.php?id=7',
          text: async () => '<html><head><title>Assignment</title></head><div id="intro"><div class="no-overflow">Description</div></div></html>',
        });
      }
      if (testCase.key.includes('course-content')) {
        fetchMock.mockResolvedValue({
          ok: true,
          status: 200,
          url: 'https://kulon2.undip.ac.id/course/view.php?id=7',
          text: async () =>
            '<li id="section-1" data-sectionname="Week 1"><div class="activity-item" data-activityname="Read syllabus"><a href="/mod/resource/view.php?id=42"></a></div></ul>',
        });
      }

      const result = await testCase.run(service);

      if (testCase.key.includes('course-content')) {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/course/view.php?id=7'),
          expect.anything(),
        );
        expect(result).toEqual({
          courseId: 7,
          sections: [
            expect.objectContaining({
              id: 1,
              items: [
                expect.objectContaining({
                  kind: 'file',
                  name: 'Read syllabus',
                  url: '/mod/resource/view.php?id=42',
                  cmid: 42,
                }),
              ],
            }),
          ],
        });
      }

      expect(cache.set).toHaveBeenCalledTimes(1);
      expect(cache.set).toHaveBeenCalledWith(testCase.key, expect.anything());
    }
  });
});
