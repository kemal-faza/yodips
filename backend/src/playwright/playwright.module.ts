import { Module } from '@nestjs/common';
import { PlaywrightAuthService } from './playwright-auth.service';

@Module({
  providers: [PlaywrightAuthService],
  exports: [PlaywrightAuthService],
})
export class PlaywrightModule {}