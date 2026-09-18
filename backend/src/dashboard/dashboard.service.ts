import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { SiapService } from '../siap/siap.service';
import { KulonService } from '../kulon/kulon.service';
import { SessionRef, isSessionRef } from '../session/session-store';
import { sessionDead } from '../session/live-session';
import { ERROR_CODES } from '../common/error-codes';
import {
  createNoopTelemetryRuntime,
  elapsedMs,
  recordTelemetry,
  TELEMETRY_RUNTIME,
  type TelemetryRuntime,
} from '../observability/telemetry';
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
  'profile' | 'khs' | 'irs' | 'jadwal' | 'courses' | 'assignments';

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

function isAuthenticatedFailure(e: unknown): boolean {
  if (!(e instanceof HttpException)) return false;
  if (e.getStatus() === HttpStatus.UNAUTHORIZED) return true;
  const response = e.getResponse();
  return (
    typeof response === 'object' &&
    response !== null &&
    (response as { code?: unknown }).code === ERROR_CODES.SESSION_DEAD
  );
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger('Dashboard');
  private readonly runtime: TelemetryRuntime;

  constructor(
    @Optional() private readonly siap?: SiapService,
    @Optional() private readonly kulon?: KulonService,
    @Optional() @Inject(TELEMETRY_RUNTIME) runtime?: TelemetryRuntime,
  ) {
    this.runtime = runtime ?? createNoopTelemetryRuntime();
  }

  private observeSlice(
    name: DashboardSliceName,
    started: bigint,
    outcome: 'ok' | 'error',
    status: number,
  ): void {
    recordTelemetry(this.runtime, {
      event: 'dashboard.slice',
      route: 'GET /api/dashboard',
      slice: name,
      outcome,
      status,
      durationMs: elapsedMs(started, this.runtime.monotonicNowNs()),
    });
  }

  private timedSlice(
    name: DashboardSliceName,
    run: () => Promise<unknown>,
  ): Promise<unknown> {
    const started = this.runtime.monotonicNowNs();
    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(run());
    } catch (error) {
      pending = Promise.reject(error);
    }
    return pending.then(
      (value) => {
        this.observeSlice(name, started, 'ok', HttpStatus.OK);
        return value;
      },
      (error) => {
        this.observeSlice(
          name,
          started,
          'error',
          error instanceof HttpException
            ? error.getStatus()
            : HttpStatus.INTERNAL_SERVER_ERROR,
        );
        throw error;
      },
    );
  }

  async getDashboard(ref: SessionRef): Promise<DashboardPayload> {
    if (!isSessionRef(ref)) {
      throw sessionDead();
    }
    const runs: Array<{ name: DashboardSliceName; p: Promise<unknown> }> = [
      {
        name: 'profile',
        p: this.timedSlice(
          'profile',
          () => this.siap?.getProfile(ref) ?? Promise.resolve(null),
        ),
      },
      {
        name: 'khs',
        p: this.timedSlice(
          'khs',
          () => this.siap?.getKhs(ref) ?? Promise.resolve(null),
        ),
      },
      {
        name: 'irs',
        p: this.timedSlice(
          'irs',
          () => this.siap?.getIrs(ref) ?? Promise.resolve(null),
        ),
      },
      {
        name: 'jadwal',
        p: this.timedSlice(
          'jadwal',
          () => this.siap?.getJadwal(ref) ?? Promise.resolve([]),
        ),
      },
      {
        name: 'courses',
        p: this.timedSlice(
          'courses',
          () => this.kulon?.getCourseSummary(ref) ?? Promise.resolve([]),
        ),
      },
      {
        name: 'assignments',
        p: this.timedSlice(
          'assignments',
          () => this.kulon?.getAllAssignments(ref) ?? Promise.resolve([]),
        ),
      },
    ];
    const settled = await Promise.allSettled(runs.map((r) => r.p));
    const out: DashboardPayload = { ...(EMPTY as unknown as DashboardPayload) };
    const errors: DashboardPayload['errors'] = {};
    settled.forEach((res, i) => {
      const name = runs[i].name;
      if (res.status === 'fulfilled') {
        (out as unknown as Record<string, unknown>)[name] = res.value;
      } else {
        if (isAuthenticatedFailure(res.reason)) throw res.reason;
        const se = sliceError(res.reason);
        this.logger.debug(
          `[dashboard] slice ${name} failed status=${se.status}`,
        );
        (out as unknown as Record<string, unknown>)[name] = Array.isArray(
          EMPTY[name],
        )
          ? []
          : null;
        errors[name] = se;
      }
    });
    out.errors = errors;
    return out;
  }
}
