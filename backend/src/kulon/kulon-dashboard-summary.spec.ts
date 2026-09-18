import 'reflect-metadata';
import { KulonService, type KulonCourse } from './kulon.service';
import type { DataCache } from '../cache/data-cache';
import type { SessionStore } from '../session/session-store';
import type { KulonUpstreamSession } from './kulon-upstream.session';
import { cacheKeyForSession } from '../session/session-scope';
import { swrWindow } from '../cache/cache-policy';

const GENERATION = 'a'.repeat(32);
const ref = (sub = 'u1', sessionGeneration = GENERATION) => ({
  sub,
  sessionGeneration,
});

const NO_STORE: SessionStore = {
  get: async () => null,
  getIfGeneration: async () => null,
  clear: async () => undefined,
  clearIfGeneration: async () => true,
  set: async () => undefined,
  all: async () => [],
};

function makeUpstream(overrides: Record<string, unknown> = {}) {
  return {
    getContextForSession: jest.fn().mockResolvedValue({ cookie: 'cookie', sesskey: 'sesskey' }),
    getContextForCurrent: jest.fn(),
    ajax: jest.fn().mockResolvedValue({ courses: [] }),
    ...overrides,
  } as unknown as KulonUpstreamSession;
}

function makeCache() {
  return {
    get: jest.fn().mockResolvedValue(null),
    getStale: jest.fn(async (_key: string, fetcher: () => Promise<unknown>) => ({
      value: await fetcher(),
      stale: false,
    })),
    set: jest.fn(),
    del: jest.fn(),
  } as unknown as DataCache;
}

describe('KulonService dashboard course summary', () => {
  it('provides a list payload without progress or lecturer fan-out', async () => {
    const cache = makeCache();
    const upstream = makeUpstream();
    const siap = {
      getLecturers: jest.fn().mockResolvedValue([{ kode: 'M1', dosen: 'Dr. X' }]),
    };
    const service = new KulonService(NO_STORE, cache, siap as any, upstream);
    const courses: KulonCourse[] = [
      {
        id: 1,
        fullname: 'Course A',
        shortname: 'M1',
        idnumber: '',
        semester: '2026/2027 Ganjil',
        timelineStatus: 'inprogress',
      },
    ];
    jest.spyOn(service, 'fetchTimelineCourses').mockResolvedValue(courses as any);
    const progress = jest.spyOn(service as any, 'fetchCourseContent');

    await expect(service.getCourseList(ref())).resolves.toEqual(courses);

    expect(progress).not.toHaveBeenCalled();
    expect(siap.getLecturers).not.toHaveBeenCalled();
    expect(cache.getStale).toHaveBeenCalledWith(
      cacheKeyForSession(ref(), 'kulon', 'courses', 'list'),
      expect.any(Function),
      swrWindow('KULON_COURSES'),
    );
  });

  it('reuses the list cache when assignments aggregate courses', async () => {
    const cache = makeCache();
    const listKey = cacheKeyForSession(ref(), 'kulon', 'courses', 'list');
    (cache.getStale as jest.Mock).mockResolvedValue({
      value: [{ id: 7, fullname: 'Course A', shortname: 'M1', idnumber: '', timelineStatus: 'inprogress' }],
      stale: false,
    });
    const upstream = makeUpstream();
    const service = new KulonService(NO_STORE, cache, undefined, upstream);
    const listFetch = jest.spyOn(service as any, 'fetchTimelineBase');
    jest.spyOn(service as any, 'fetchAssignmentIndex').mockResolvedValue([]);
    jest.spyOn(service as any, 'fetchQuizIndex').mockResolvedValue([]);

    await expect((service as any).fetchAllAssignments('cookie', 'sesskey', { kind: 'session', ref: ref() })).resolves.toEqual([]);

    expect(listFetch).not.toHaveBeenCalled();
    expect(cache.getStale).toHaveBeenCalledWith(
      listKey,
      expect.any(Function),
      swrWindow('KULON_COURSES'),
    );
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('returns lecturer-ready course fields without scraping course progress', async () => {
    const cache = makeCache();
    const upstream = makeUpstream();
    const siap = {
      getLecturers: jest.fn().mockResolvedValue([{ kode: 'M1', dosen: 'Dr. X' }]),
    };
    const service = new KulonService(NO_STORE, cache, siap as any, upstream);
    const courses: KulonCourse[] = [
      {
        id: 1,
        fullname: 'Course A',
        shortname: 'M1',
        idnumber: '',
        semester: '2026/2027 Ganjil',
        timelineStatus: 'inprogress',
      },
    ];
    jest.spyOn(service, 'fetchTimelineCourses').mockResolvedValue(courses as any);
    const progress = jest.spyOn(service as any, 'fetchCourseContent');

    await expect(service.getCourseSummary(ref())).resolves.toEqual([
      { ...courses[0], lecturer: 'Dr. X' },
    ]);

    expect(progress).not.toHaveBeenCalled();
    expect(siap.getLecturers).toHaveBeenCalledWith(ref());
    expect(cache.getStale).toHaveBeenCalledWith(
      cacheKeyForSession(ref(), 'kulon', 'courses', 'summary'),
      expect.any(Function),
      swrWindow('KULON_COURSES'),
    );
  });

  it('shares the three timeline classifications between concurrent summary and assignment loads', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const timelineCalls: string[] = [];
    const upstream = makeUpstream({
      ajax: jest.fn(async (_cookie: string, _sesskey: string, method: string, args: { classification?: string }) => {
        if (method === 'core_course_get_enrolled_courses_by_timeline_classification') {
          timelineCalls.push(args.classification ?? '');
          await gate;
          return { courses: [] };
        }
        throw new Error(`unexpected method ${method}`);
      }),
    });
    const service = new KulonService(NO_STORE, undefined, undefined, upstream);

    const summary = service.getCourseSummary(ref());
    const assignments = service.getAllAssignments(ref());
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await expect(Promise.all([summary, assignments])).resolves.toEqual([[], []]);

    expect(timelineCalls.sort()).toEqual(['all', 'hidden', 'inprogress']);
  });

  it('keeps timeline flights isolated by session generation', async () => {
    const timelineCalls: string[] = [];
    const upstream = makeUpstream({
      ajax: jest.fn(async (_cookie: string, _sesskey: string, method: string, args: { classification?: string }) => {
        if (method === 'core_course_get_enrolled_courses_by_timeline_classification') {
          timelineCalls.push(args.classification ?? '');
          return { courses: [] };
        }
        throw new Error(`unexpected method ${method}`);
      }),
    });
    const service = new KulonService(NO_STORE, undefined, undefined, upstream);

    await Promise.all([
      service.getCourseSummary(ref('u1', 'a'.repeat(32))),
      service.getCourseSummary(ref('u1', 'b'.repeat(32))),
    ]);

    expect(timelineCalls).toHaveLength(6);
  });

  it('bounds public progress scraping while preserving per-course failures', async () => {
    const upstream = makeUpstream();
    const service = new KulonService(NO_STORE, undefined, undefined, upstream);
    const courses = Array.from({ length: 9 }, (_, i) => ({
      id: i + 1,
      fullname: `Course ${i + 1}`,
      shortname: `M${i + 1}`,
      idnumber: '',
      timelineStatus: 'inprogress' as const,
    }));
    jest.spyOn(service, 'fetchTimelineCourses').mockImplementation(
      async (_cookie, _sesskey, classification) =>
        classification === 'all' ? courses : [],
    );
    let active = 0;
    let maximum = 0;
    jest.spyOn(service as any, 'fetchCourseContent').mockImplementation(async (_cookie: string, _sesskey: string, courseId: number) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      if (courseId === 3) throw new Error('one course failed');
      return { sections: [] };
    });

    const result = await service.getCourses(ref());

    expect(maximum).toBeLessThanOrEqual(4);
    expect(result).toHaveLength(courses.length);
    expect(result.find((course) => course.id === 3)?.progress).toBeUndefined();
  });
});
