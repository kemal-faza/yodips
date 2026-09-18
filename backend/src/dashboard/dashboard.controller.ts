import {
  Controller,
  Get,
  HttpException,
  Inject,
  Optional,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { isSessionRef } from '../session/session-store';
import { sessionDead } from '../session/live-session';
import {
  createNoopTelemetryRuntime,
  elapsedMs,
  recordTelemetry,
  TELEMETRY_RUNTIME,
  type TelemetryRuntime,
} from '../observability/telemetry';
import {
  DASHBOARD_CACHE_STATE_HEADER,
  type DashboardCacheState,
} from '../observability/telemetry-contract';

interface AuthedRequest {
  user?: { sub?: string; sessionGeneration?: unknown; [k: string]: unknown };
  headers?: Record<string, string | string[] | undefined>;
}

const CACHE_STATES: readonly DashboardCacheState[] = [
  'cold',
  'warm',
  'mixed',
  'unknown',
];

function measurementCacheState(req: AuthedRequest): DashboardCacheState {
  const raw = req.headers?.[DASHBOARD_CACHE_STATE_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return CACHE_STATES.includes(value as DashboardCacheState)
    ? (value as DashboardCacheState)
    : 'unknown';
}

function statusFromError(error: unknown): number {
  return error instanceof HttpException ? error.getStatus() : 500;
}

function responseBytes(value: unknown): number | undefined {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined
      ? undefined
      : Buffer.byteLength(serialized, 'utf8');
  } catch {
    return undefined;
  }
}

@UseGuards(JwtAuthGuard)
@Controller('api/dashboard')
export class DashboardController {
  private readonly runtime: TelemetryRuntime;

  constructor(
    private readonly dashboardService: DashboardService,
    @Optional() @Inject(TELEMETRY_RUNTIME) runtime?: TelemetryRuntime,
  ) {
    this.runtime = runtime ?? createNoopTelemetryRuntime();
  }

  @Get()
  async getDashboard(@Req() req: AuthedRequest) {
    const started = this.runtime.monotonicNowNs();
    const cacheState = measurementCacheState(req);
    try {
      if (!isSessionRef(req.user)) {
        throw sessionDead();
      }
      const payload = await this.dashboardService.getDashboard({
        sub: req.user.sub,
        sessionGeneration: req.user.sessionGeneration,
      });
      recordTelemetry(this.runtime, {
        event: 'dashboard.request',
        route: 'GET /api/dashboard',
        outcome: 'ok',
        status: 200,
        durationMs: elapsedMs(started, this.runtime.monotonicNowNs()),
        responseBytes: responseBytes(payload) ?? 0,
        cacheState,
      });
      return payload;
    } catch (error) {
      recordTelemetry(this.runtime, {
        event: 'dashboard.request',
        route: 'GET /api/dashboard',
        outcome: 'error',
        status: statusFromError(error),
        durationMs: elapsedMs(started, this.runtime.monotonicNowNs()),
        cacheState,
      });
      throw error;
    }
  }
}
