import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SessionModule } from '../session/session.module';
import { SiapModule } from '../siap/siap.module';
import { CacheModule } from '../cache/cache.module';
import { KulonController } from './kulon.controller';
import { KulonService } from './kulon.service';
import { KulonSessionProbe } from './kulon-session-probe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Module({
  imports: [
    SessionModule,
    SiapModule,
    CacheModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        secret: c.get<string>('JWT_SECRET')!,
        signOptions: { expiresIn: c.get<string>('JWT_EXPIRES_IN')! as never },
      }),
    }),
  ],
  controllers: [KulonController],
  providers: [KulonService, KulonSessionProbe, JwtAuthGuard],
  exports: [KulonService, KulonSessionProbe],
})
export class KulonModule {}
