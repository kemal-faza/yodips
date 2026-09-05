import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { DashboardService, type DashboardPayload } from './dashboard.service';
import { StaleUpstreamError } from '../upstream/upstream-fetch';
import type { SiapProfile } from '../siap/siap-parse';
import type { KulonAssignment, KulonCourse } from '../kulon/kulon-parse';

const PROFILE: SiapProfile = { nama: 'A', nim: '2406', fakultas: 'F', prodi: 'P', angkatan: '2024', status: 'AKTIF' } as SiapProfile;
const COURSE: KulonCourse = { id: 1, fullname: 'C1', shortname: 'M1', idnumber: 'MIK1', semester: '2026/2027 Ganjil', timelineStatus: 'inprogress', progress: 50 } as KulonCourse;
const ASSIGN: KulonAssignment = { id: 1, name: 'T1', module: 'assign', duedate: 0, overdue: false, course: 'C1', courseId: 1, assignmentId: 1, courseModuleId: 1 } as KulonAssignment;

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
      getCourses: jest.fn().mockResolvedValue([COURSE]),
      getAllAssignments: jest.fn().mockResolvedValue([ASSIGN]),
    },
  };
  if (overrides.getProfile) deps.siap.getProfile = overrides.getProfile;
  if (overrides.getKhs) deps.siap.getKhs = overrides.getKhs;
  if (overrides.getIrs) deps.siap.getIrs = overrides.getIrs;
  if (overrides.getJadwal) deps.siap.getJadwal = overrides.getJadwal;
  if (overrides.getCourses) deps.kulon.getCourses = overrides.getCourses;
  if (overrides.getAllAssignments) deps.kulon.getAllAssignments = overrides.getAllAssignments;
  return new DashboardService(deps.siap as any, deps.kulon as any);
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
      getCourses: jest.fn().mockRejectedValue(dead),
    });
    await expect(svc.getDashboard(ref('u1'))).rejects.toBe(dead);
  });

  it('maps a 502 transient StaleUpstreamError to errors with 502', async () => {
    const svc = makeService({
      getJadwal: jest.fn().mockRejectedValue(new StaleUpstreamError('SIAP', 'fetch-threw')),
    });
    const out = await svc.getDashboard(ref('u1'));
    expect(out.errors.jadwal).toEqual({ status: 502, message: expect.stringContaining('SIAP') });
  });

  it('maps a plain non-HTTP Error to 500 with a generic message (no detail leak)', async () => {
    const svc = makeService({
      getCourses: jest.fn().mockRejectedValue(new Error('internal secret') as never),
    });
    const out = await svc.getDashboard(ref('u1'));
    expect(out.courses).toEqual([]);
    expect(out.errors.courses).toEqual({ status: 500, message: 'Terjadi kesalahan internal' });
    expect(JSON.stringify(out.errors)).not.toContain('internal secret');
  });

  it('joins array messages from HttpException with a comma', async () => {
    const svc = makeService({
      getIrs: jest.fn().mockRejectedValue(new HttpException({ message: ['a', 'b'] }, HttpStatus.BAD_REQUEST) as never),
    });
    const out = await svc.getDashboard(ref('u1'));
    expect(out.errors.irs).toEqual({ status: 400, message: 'a, b' });
  });

  it('passes the exact SessionRef to every domain method (none drops generation)', async () => {
    const getCourses = jest.fn().mockResolvedValue([COURSE]);
    const getAllAssignments = jest.fn().mockResolvedValue([ASSIGN]);
    const svc = makeService({ getCourses, getAllAssignments });
    await svc.getDashboard(ref('u1'));
    expect(getCourses).toHaveBeenCalledWith(ref('u1'));
    expect(getAllAssignments).toHaveBeenCalledWith(ref('u1'));
  });
});
