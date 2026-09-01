import type { TelemetryEventInput } from './telemetry-contract';

export interface TelemetrySink {
  record(event: TelemetryEventInput): void;
}

export interface TelemetryRuntime {
  sink: TelemetrySink;
  wallNowMs(): number;
  monotonicNowNs(): bigint;
}

export const TELEMETRY_SINK = Symbol('TELEMETRY_SINK');
export const TELEMETRY_RUNTIME = Symbol('TELEMETRY_RUNTIME');

export function createNoopTelemetryRuntime(): TelemetryRuntime {
  return {
    sink: { record: () => undefined },
    wallNowMs: Date.now,
    monotonicNowNs: process.hrtime.bigint,
  };
}

export function elapsedMs(startNs: bigint, endNs: bigint): number {
  const delta = endNs > startNs ? endNs - startNs : 0n;
  const milliseconds = delta / 1_000_000n;
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(milliseconds > maximum ? maximum : milliseconds);
}

export function safeAgeMs(now: number, fetchedAt: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(fetchedAt)) return 0;
  const age = now - fetchedAt;
  if (!Number.isFinite(age)) return age > 0 ? Number.MAX_SAFE_INTEGER : 0;
  return age > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : Math.max(0, Math.floor(age));
}

export function recordTelemetry(runtime: TelemetryRuntime, event: TelemetryEventInput): void {
  try {
    runtime.sink.record(event);
  } catch {
    // Telemetry is best-effort and must never change application behavior.
  }
}
