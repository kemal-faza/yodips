import { Controller, Get, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LegacyAuthService } from './legacy-auth.service';

@Controller('api/auth')
export class LegacyAuthController {
  constructor(private readonly legacyAuth: LegacyAuthService) {}

  // Token-minting legacy fallback. Route registration is limited to dev/test.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('sso/capture')
  captureSsoSession() {
    return this.legacyAuth.captureSsoSession();
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('microsoft/login')
  microsoftLogin() {
    return this.legacyAuth.getMicrosoftAuthUrl();
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('microsoft/callback')
  microsoftCallback(@Query('code') code: string, @Query('state') state?: string) {
    return this.legacyAuth.handleMicrosoftCallback(code, state);
  }
}
