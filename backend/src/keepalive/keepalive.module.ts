import { Module } from '@nestjs/common';
import { KulonModule } from '../kulon/kulon.module';
import { SiapModule } from '../siap/siap.module';
import { SessionModule } from '../session/session.module';
import { ObservabilityModule } from '../observability/observability.module';
import { SsoSessionProbe } from './sso-session.probe';
import { SessionKeepAliveService } from './session-keepalive.service';

@Module({
  imports: [SessionModule, KulonModule, SiapModule, ObservabilityModule],
  providers: [SsoSessionProbe, SessionKeepAliveService],
})
export class KeepAliveModule {}
