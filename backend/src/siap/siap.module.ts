import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SessionModule } from '../session/session.module';
import { CacheModule } from '../cache/cache.module';
import { ObservabilityModule } from '../observability/observability.module';
import { TELEMETRY_RUNTIME, type TelemetryRuntime } from '../observability/telemetry';
import { SiapController } from './siap.controller';
import { SiapService } from './siap.service';
import { SiapUpstreamSession } from './siap-upstream.session';
import { SiapApiUpstream } from './siap-api';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Module({
  imports: [
    SessionModule,
    CacheModule,
    ObservabilityModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        secret: c.get<string>('JWT_SECRET')!,
        signOptions: { expiresIn: c.get<string>('JWT_EXPIRES_IN')! as never },
      }),
    }),
  ],
  controllers: [SiapController],
  providers: [
    SiapUpstreamSession,
    {
      provide: SiapApiUpstream,
      inject: [ConfigService, TELEMETRY_RUNTIME],
      useFactory: (c: ConfigService, runtime: TelemetryRuntime) =>
        new SiapApiUpstream(
          c.get<string>('SIAP_API_BASE') ?? 'https://api.siap.undip.ac.id/index.php',
          c.get<string>('SIAP_APP_VER') ?? '24',
          runtime,
        ),
    },
    SiapService,
    JwtAuthGuard,
  ],
  exports: [SiapService, SiapUpstreamSession],
})
export class SiapModule {}
