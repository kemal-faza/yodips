import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module';
import { KulonModule } from '../kulon/kulon.module';
import { SiapModule } from '../siap/siap.module';
import { AuthModule } from '../auth/auth.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

// Pakai JwtModule ter-pin + JwtAuthGuard MILIK AuthModule (di-import), BUKAN
// registrasi JwtModule baru (Kulon/Siap pattern): duplikasi instansi JwtService
// mengubah instansi yang di-resolve `app.get(JwtService)` — token e2e yang
// di-sign TANPA iss/aud default ditolak /auth/refresh (pinned
// issuer='yodips', audience='yodips-web') sebagai INVALID_TOKEN. Sama dengan
// catatan di notifications.module.ts / pairing.module.ts.
@Module({
  imports: [
    SessionModule,
    KulonModule,
    SiapModule,
    AuthModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
