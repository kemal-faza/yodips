import { Module } from '@nestjs/common';
import { KulonModule } from '../kulon/kulon.module';
import { PlaywrightAuthService } from './playwright-auth.service';

@Module({
  imports: [KulonModule],
  providers: [PlaywrightAuthService],
  exports: [PlaywrightAuthService],
})
export class PlaywrightModule {}
