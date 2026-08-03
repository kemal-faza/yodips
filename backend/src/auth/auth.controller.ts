import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.identity, dto.password);
  }

  // captureSsoSession IS the login mechanism (it generates the JWT in the
  // response), so it must NOT require a JWT. DoS (repeated browser launches)
  // is mitigated by the aggressive @Throttle below (5/min).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('sso/capture')
  captureSsoSession() {
    return this.authService.captureSsoSession();
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('microsoft/login')
  microsoftLogin() {
    return this.authService.getMicrosoftAuthUrl();
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('microsoft/callback')
  microsoftCallback(@Query('code') code: string, @Query('state') state?: string) {
    return this.authService.handleMicrosoftCallback(code, state);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return this.authService.me(req.user);
  }
}