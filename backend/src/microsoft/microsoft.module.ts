import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ObservabilityModule } from '../observability/observability.module';
import { TELEMETRY_RUNTIME, type TelemetryRuntime } from '../observability/telemetry';
import { MicrosoftAuthService } from './microsoft-auth.service';

@Module({
  imports: [ObservabilityModule],
  providers: [
    {
      provide: MicrosoftAuthService,
      inject: [ConfigService, TELEMETRY_RUNTIME],
      useFactory: (c: ConfigService, runtime: TelemetryRuntime) =>
        new MicrosoftAuthService({
          tenantId: c.get<string>('MS_TENANT_ID')!,
          clientId: c.get<string>('MS_CLIENT_ID')!,
          clientSecret: c.get<string>('MS_CLIENT_SECRET')!,
          redirectUri: c.get<string>('MS_REDIRECT_URI')!,
        }, runtime),
    },
  ],
  exports: [MicrosoftAuthService],
})
export class MicrosoftModule {}
