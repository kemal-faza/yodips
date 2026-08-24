import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { KulonModule } from '../kulon/kulon.module';
import { SiapModule } from '../siap/siap.module';
import { SessionModule } from '../session/session.module';
import { FcmService } from './fcm.service';
import { createNotificationStore } from './notification-store.factory';
import { NotificationStore } from './notification-store';
import { NotificationsController } from './notifications.controller';
import { NotificationsPoller } from './poller.service';

// NOTE(deviation from plan): the plan registered its own bare JwtModule here
// (Kulon/Siap pattern) + a local JwtAuthGuard provider. A 4th JwtService
// instance changed which instance `app.get(JwtService)` resolves to in
// auth.refresh.e2e.spec.ts — tokens were then signed WITHOUT iss/aud defaults
// and /auth/refresh (which pins issuer='yodips', audience='yodips-web')
// rejected them as INVALID_TOKEN. AuthModule already exports JwtModule (pinned
// signOptions) and JwtAuthGuard, so we consume those instead of duplicating
// registration; only Kulon/Siap/Session modules + ScheduleModule were added.
@Module({
  imports: [
    AuthModule,
    KulonModule,   // KulonService + KulonUpstreamSession (exports)
    SiapModule,    // SiapService
    SessionModule, // SessionStore
    ScheduleModule.forRoot(),
  ],
  controllers: [NotificationsController],
  providers: [
    FcmService,
    {
      provide: NotificationStore,
      inject: [ConfigService],
      useFactory: createNotificationStore,
    },
    NotificationsPoller,
  ],
  exports: [FcmService, NotificationStore],
})
export class NotificationsModule {}
