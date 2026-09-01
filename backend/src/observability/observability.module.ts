import { Global, Module } from '@nestjs/common';
import { NestTelemetrySink } from './nest-telemetry.sink';
import { TELEMETRY_RUNTIME, TELEMETRY_SINK, TelemetryRuntime } from './telemetry';

@Global()
@Module({
  providers: [
    NestTelemetrySink,
    { provide: TELEMETRY_SINK, useExisting: NestTelemetrySink },
    {
      provide: TELEMETRY_RUNTIME,
      inject: [NestTelemetrySink],
      useFactory: (sink: NestTelemetrySink): TelemetryRuntime => ({
        sink,
        wallNowMs: Date.now,
        monotonicNowNs: process.hrtime.bigint,
      }),
    },
  ],
  exports: [TELEMETRY_SINK, TELEMETRY_RUNTIME],
})
export class ObservabilityModule {}
