import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';
import { SSOModule } from './sso/sso.module';
import { CacheModule } from './cache/cache.module';
import { AuthModule } from './auth/auth.module';
import { KulonModule } from './kulon/kulon.module';
import { SiapModule } from './siap/siap.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PairingModule } from './pairing/pairing.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: ['.env'],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 30,
      },
    ]),
    SSOModule,
    CacheModule,
    AuthModule,
    KulonModule,
    SiapModule,
    NotificationsModule,
    PairingModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
