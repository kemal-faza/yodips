import 'reflect-metadata';
import { KulonService } from './kulon.service';
import type { KulonUpstreamSession } from './kulon-upstream.session';
import type {
  KulonCourse,
  KulonCourseContent,
} from './kulon-parse';

type CacheMock = {
  get: jest.Mock;
  getStale: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
};

type UpstreamMock = {
  getContext: jest.Mock;
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

function makeUpstream(): UpstreamMock {
  return {
    getContext: jest
      .fn()
      .mockResolvedValue({ cookie: 'cookie', sesskey: 'sesskey' }),
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
          return Promise.reject(new Error(`unexpected upstream method: ${method}`));
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
      cache as any,
      undefined,
      upstream as unknown as KulonUpstreamSession,
    );
    internals(service).fetchCourseContent = () =>
      Promise.resolve({ courseId: 1, sections: [] });

    const result = await service.getCourses('u1');

    expect(result[0]?.id).toBe(1);
    const staleCalls = cache.getStale.mock.calls as unknown as Array<[
      string,
      () => Promise<KulonCourse[]>,
      { freshTtlMs: number; staleTtlMs: number },
    ]>;
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
      cache as any,
      undefined,
      upstream as unknown as KulonUpstreamSession,
    );

    const result = await internals(service).fetchCourses(
      'cookie',
      'sesskey',
      'u1',
      { withProgress: false },
    );

    expect(result).toEqual(cachedCourses);
    expect(cache.get).toHaveBeenCalledWith('u1:kulon:courses');
    expect(upstream.ajax).not.toHaveBeenCalled();
  });
});
