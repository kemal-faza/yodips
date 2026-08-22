import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { FcmService } from './fcm.service';
import { createNotificationStore } from './notification-store.factory';
import { NotificationStore } from './notification-store';
import { NotificationsController } from './notifications.controller';

// NOTE(deviation from plan): the plan registered its own bare JwtModule here
// (Kulon/Siap pattern). A 4th JwtService instance changed which instance
// `app.get(JwtService)` resolves to in auth.refresh.e2e.spec.ts — tokens were
// then signed WITHOUT iss/aud defaults and /auth/refresh (which pins
// issuer='yodips', audience='yodips-web') rejected them as INVALID_TOKEN.
// AuthModule already exports JwtModule (pinned signOptions) and JwtAuthGuard,
// so we consume those instead of duplicating registration.
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    FcmService,
    {
      provide: NotificationStore,
      inject: [ConfigService],
      useFactory: createNotificationStore,
    },
  ],
  exports: [FcmService, NotificationStore],
})
export class NotificationsModule {}
