import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { DashboardService, type DashboardPayload } from './dashboard.service';
import { StaleUpstreamError } from '../upstream/upstream-fetch';
import type { SiapProfile } from '../siap/siap-parse';
import type { KulonAssignment, KulonCourse } from '../kulon/kulon-parse';
import type { TelemetryRuntime } from '../observability/telemetry';

const PROFILE: SiapProfile = {
  nama: 'A',
  nim: '2406',
  fakultas: 'F',
  prodi: 'P',
  angkatan: '2024',
  status: 'AKTIF',
} as SiapProfile;
const COURSE: KulonCourse = {
  id: 1,
  fullname: 'C1',
  shortname: 'M1',
  idnumber: 'MIK1',
  semester: '2026/2027 Ganjil',
  timelineStatus: 'inprogress',
  progress: 50,
} as KulonCourse;
const ASSIGN: KulonAssignment = {
  id: 1,
  name: 'T1',
  module: 'assign',
  duedate: 0,
  overdue: false,
  course: 'C1',
  courseId: 1,
  assignmentId: 1,
  courseModuleId: 1,
} as KulonAssignment;

const GEN = 'a'.repeat(32);
const ref = (sub: string) => ({ sub, sessionGeneration: GEN });

function makeService(overrides: Record<string, jest.Mock>): DashboardService {
  const deps = {
    siap: {
      getProfile: jest.fn().mockResolvedValue(PROFILE),
      getKhs: jest.fn().mockResolvedValue(null),
      getIrs: jest.fn().mockResolvedValue(null),
      getJadwal: jest.fn().mockResolvedValue([]),
    },
    kulon: {
      getCourseSummary: jest.fn().mockResolvedValue([COURSE]),
      getCourses: jest.fn().mockResolvedValue([COURSE]),
      getAllAssignments: jest.fn().mockResolvedValue([ASSIGN]),
    },
  };
  if (overrides.getProfile) deps.siap.getProfile = overrides.getProfile;
  if (overrides.getKhs) deps.siap.getKhs = overrides.getKhs;
  if (overrides.getIrs) deps.siap.getIrs = overrides.getIrs;
  if (overrides.getJadwal) deps.siap.getJadwal = overrides.getJadwal;
  if (overrides.getCourseSummary)
    deps.kulon.getCourseSummary = overrides.getCourseSummary;
  if (overrides.getCourses) deps.kulon.getCourses = overrides.getCourses;
  if (overrides.getAllAssignments)
    deps.kulon.getAllAssignments = overrides.getAllAssignments;
  return new DashboardService(deps.siap as any, deps.kulon as any);
}

function recordingRuntime(): { runtime: TelemetryRuntime; events: unknown[] } {
  const events: unknown[] = [];
  const runtime: TelemetryRuntime = {
    sink: { record: (event) => events.push(event) },
    wallNowMs: () => 1_725_148_800_000,
    monotonicNowNs: () => 1_000_000n,
  };
  return { runtime, events };
}

describe('DashboardService', () => {
  it('returns all slices + empty errors when every domain method succeeds', async () => {
    const svc = makeService({});
    const out: DashboardPayload = await svc.getDashboard(ref('u1'));
    expect(out.profile).toEqual(PROFILE);
    expect(out.courses).toEqual([COURSE]);
    expect(out.assignments).toEqual([ASSIGN]);
    expect(out.errors).toEqual({});
    expect(out.khs).toBeNull();
    expect(out.irs).toBeNull();
    expect(out.jadwal).toEqual([]);
  });

  it('uses the progress-free course summary path instead of public courses', async () => {
    const getCourseSummary = jest.fn().mockResolvedValue([COURSE]);
    const getCourses = jest.fn().mockRejectedValue(new Error('public path must not run'));
    const svc = makeService({ getCourseSummary, getCourses });

    await expect(svc.getDashboard(ref('u1'))).resolves.toEqual(
      expect.objectContaining({ courses: [COURSE] }),
    );
    expect(getCourseSummary).toHaveBeenCalledWith(ref('u1'));
    expect(getCourses).not.toHaveBeenCalled();
  });

  it('rethrows a 401 StaleUpstreamError instead of degrading an authenticated slice', async () => {
    const stale = new StaleUpstreamError('SIAP', 'login-redirect');
    const svc = makeService({
      getProfile: jest.fn().mockRejectedValue(stale),
    });
    await expect(svc.getDashboard(ref('u1'))).rejects.toBe(stale);
  });

  it('rethrows SESSION_DEAD from a settled slice', async () => {
    const dead = new HttpException(
      { message: 'Sesi berakhir', code: 'SESSION_DEAD' },
      HttpStatus.UNAUTHORIZED,
    );
    const svc = makeService({
      getCourseSummary: jest.fn().mockRejectedValue(dead),
    });
    await expect(svc.getDashboard(ref('u1'))).rejects.toBe(dead);
  });

  it('maps a 502 transient StaleUpstreamError to errors with 502', async () => {
    const svc = makeService({
      getJadwal: jest
        .fn()
        .mockRejectedValue(new StaleUpstreamError('SIAP', 'fetch-threw')),
    });
    const out = await svc.getDashboard(ref('u1'));
    expect(out.errors.jadwal).toEqual({
      status: 502,
      message: expect.stringContaining('SIAP'),
    });
  });

  it('maps a plain non-HTTP Error to 500 with a generic message (no detail leak)', async () => {
    const svc = makeService({
      getCourseSummary: jest
        .fn()
        .mockRejectedValue(new Error('internal secret') as never),
    });
    const out = await svc.getDashboard(ref('u1'));
    expect(out.courses).toEqual([]);
    expect(out.errors.courses).toEqual({
      status: 500,
      message: 'Terjadi kesalahan internal',
    });
    expect(JSON.stringify(out.errors)).not.toContain('internal secret');
  });

  it('joins array messages from HttpException with a comma', async () => {
    const svc = makeService({
      getIrs: jest
        .fn()
        .mockRejectedValue(
          new HttpException(
            { message: ['a', 'b'] },
            HttpStatus.BAD_REQUEST,
          ) as never,
        ),
    });
    const out = await svc.getDashboard(ref('u1'));
    expect(out.errors.irs).toEqual({ status: 400, message: 'a, b' });
  });

  it('passes the exact SessionRef to every domain method (none drops generation)', async () => {
    const getCourseSummary = jest.fn().mockResolvedValue([COURSE]);
    const getAllAssignments = jest.fn().mockResolvedValue([ASSIGN]);
    const svc = makeService({ getCourseSummary, getAllAssignments });
    await svc.getDashboard(ref('u1'));
    expect(getCourseSummary).toHaveBeenCalledWith(ref('u1'));
    expect(getAllAssignments).toHaveBeenCalledWith(ref('u1'));
  });

  it('records one low-cardinality timing observation for every dashboard slice', async () => {
    const observed = recordingRuntime();
    const deps = {
      siap: {
        getProfile: jest.fn().mockResolvedValue(PROFILE),
        getKhs: jest.fn().mockResolvedValue(null),
        getIrs: jest.fn().mockResolvedValue(null),
        getJadwal: jest.fn().mockResolvedValue([]),
      },
      kulon: {
        getCourseSummary: jest.fn().mockResolvedValue([COURSE]),
        getCourses: jest.fn().mockResolvedValue([COURSE]),
        getAllAssignments: jest.fn().mockResolvedValue([ASSIGN]),
      },
    };
    const svc = new DashboardService(
      deps.siap as any,
      deps.kulon as any,
      observed.runtime,
    );
    await svc.getDashboard(ref('u1'));
    expect(observed.events).toHaveLength(6);
    expect(observed.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'dashboard.slice',
          slice: 'profile',
          outcome: 'ok',
          status: 200,
        }),
        expect.objectContaining({
          event: 'dashboard.slice',
          slice: 'khs',
          outcome: 'ok',
          status: 200,
        }),
        expect.objectContaining({
          event: 'dashboard.slice',
          slice: 'irs',
          outcome: 'ok',
          status: 200,
        }),
        expect.objectContaining({
          event: 'dashboard.slice',
          slice: 'jadwal',
          outcome: 'ok',
          status: 200,
        }),
        expect.objectContaining({
          event: 'dashboard.slice',
          slice: 'courses',
          outcome: 'ok',
          status: 200,
        }),
        expect.objectContaining({
          event: 'dashboard.slice',
          slice: 'assignments',
          outcome: 'ok',
          status: 200,
        }),
      ]),
    );
  });
});
