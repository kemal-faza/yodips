import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SessionModule } from '../session/session.module';
import { CacheModule } from '../cache/cache.module';
import { SiapController } from './siap.controller';
import { SiapService } from './siap.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Module({
  imports: [
    SessionModule,
    CacheModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        secret: c.get<string>('JWT_SECRET')!,
        signOptions: { expiresIn: c.get<string>('JWT_EXPIRES_IN')! as never },
      }),
    }),
  ],
  controllers: [SiapController],
  providers: [SiapService, JwtAuthGuard],
  exports: [SiapService],
})
export class SiapModule {}