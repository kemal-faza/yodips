import { Module } from '@nestjs/common';
import { KulonModule } from '../kulon/kulon.module';
import { SiapModule } from '../siap/siap.module';
import { SessionModule } from '../session/session.module';
import { PlaywrightAuthService } from './playwright-auth.service';

@Module({
  imports: [KulonModule, SiapModule, SessionModule],
  providers: [PlaywrightAuthService],
  exports: [PlaywrightAuthService],
})
export class PlaywrightModule {}
