import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { SessionModule } from '../session/session.module';
import { PairingController } from './pairing.controller';
import { PairingService } from './pairing.service';
import { PairingStore } from './pairing-store';
import { createPairingStore } from './pairing-store.factory';

// Pakai JwtModule ter-pin + JwtAuthGuard MILIK AuthModule (di-import), BUKAN
// registrasi JwtModule baru: duplikasi instansi JwtService pernah memecahkan
// pinning iss/aud (lihat catatan di notifications.module.ts).
@Module({
  imports: [AuthModule, SessionModule],
  controllers: [PairingController],
  providers: [
    PairingService,
    {
      provide: PairingStore,
      inject: [ConfigService],
      useFactory: createPairingStore,
    },
  ],
  exports: [PairingService],
})
export class PairingModule {}
