import { HttpException, HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { SiapService } from '../siap/siap.service';
import { KulonService } from '../kulon/kulon.service';
import { SessionRef, isSessionRef } from '../session/session-store';
import type {
  SiapIrs,
  SiapJadwal,
  SiapKhs,
  SiapProfile,
} from '../siap/siap-parse';
import type { KulonAssignment, KulonCourse } from '../kulon/kulon-parse';

/** Which data slice failed and how — surfaced per-slice, never as an HTTP error. */
export interface SliceError {
  status: number;
  message: string;
}

export type DashboardSliceName =
  | 'profile'
  | 'khs'
  | 'irs'
  | 'jadwal'
  | 'courses'
  | 'assignments';

/** Fan-out + merge over existing domain caches. NO dashboard cache/snapshot. */
export interface DashboardPayload {
  profile: SiapProfile | null;
  khs: SiapKhs | null;
  irs: SiapIrs | null;
  jadwal: SiapJadwal[];
  courses: KulonCourse[];
  assignments: KulonAssignment[];
  errors: Partial<Record<DashboardSliceName, SliceError>>;
}

const EMPTY: Record<string, unknown> = {
  profile: null,
  khs: null,
  irs: null,
  jadwal: [],
  courses: [],
  assignments: [],
};

function sliceError(e: unknown): SliceError {
  if (e instanceof HttpException) {
    const resp = e.getResponse(); // string | object
    const raw =
      typeof resp === 'string'
        ? resp
        : ((resp as { message?: unknown })?.message ?? resp);
    const message = Array.isArray(raw) ? raw.join(', ') : String(raw);
    return { status: e.getStatus(), message };
  }
  return { status: 500, message: 'Terjadi kesalahan internal' };
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger('Dashboard');

  constructor(
    @Optional() private readonly siap?: SiapService,
    @Optional() private readonly kulon?: KulonService,
  ) {}

  async getDashboard(ref: SessionRef): Promise<DashboardPayload> {
    if (!isSessionRef(ref)) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const runs: Array<{ name: DashboardSliceName; p: Promise<unknown> }> = [
      { name: 'profile', p: this.siap?.getProfile(ref) ?? Promise.resolve(null) },
      { name: 'khs', p: this.siap?.getKhs(ref) ?? Promise.resolve(null) },
      { name: 'irs', p: this.siap?.getIrs(ref) ?? Promise.resolve(null) },
      { name: 'jadwal', p: this.siap?.getJadwal(ref) ?? Promise.resolve([]) },
      { name: 'courses', p: this.kulon?.getCourses(ref) ?? Promise.resolve([]) },
      { name: 'assignments', p: this.kulon?.getAllAssignments(ref) ?? Promise.resolve([]) },
    ];
    const settled = await Promise.allSettled(runs.map((r) => r.p));
    const out: DashboardPayload = { ...(EMPTY as unknown as DashboardPayload) };
    const errors: DashboardPayload['errors'] = {};
    settled.forEach((res, i) => {
      const name = runs[i].name;
      if (res.status === 'fulfilled') {
        (out as unknown as Record<string, unknown>)[name] = res.value;
      } else {
        const se = sliceError(res.reason);
        this.logger.debug(`[dashboard] slice ${name} failed status=${se.status}`);
        (out as unknown as Record<string, unknown>)[name] = Array.isArray(EMPTY[name])
          ? []
          : null;
        errors[name] = se;
      }
    });
    out.errors = errors;
    return out;
  }
}
