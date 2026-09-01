import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SSOModule } from '../sso/sso.module';
import { MicrosoftModule } from '../microsoft/microsoft.module';
import { PlaywrightModule } from '../playwright/playwright.module';
import { SessionModule } from '../session/session.module';
import { KulonModule } from '../kulon/kulon.module';
import { SiapModule } from '../siap/siap.module';
import { ObservabilityModule } from '../observability/observability.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    SSOModule,
    MicrosoftModule,
    PlaywrightModule,
    SessionModule,
    KulonModule,
    SiapModule,
    ObservabilityModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        secret: c.get<string>('JWT_SECRET')!,
        signOptions: {
          expiresIn: c.get<string>('JWT_EXPIRES_IN')! as never,
          algorithm: 'HS256',
          issuer: 'yodips',
          audience: 'yodips-web',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
