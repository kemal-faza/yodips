import { Body, Controller, Get, HttpException, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { HandoffDto } from './dto/handoff.dto';
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

  // Handoff is THE remote login mechanism (it issues the JWT), so it must NOT
  // require a JWT. DoS is mitigated by the aggressive @Throttle below.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('session/handoff')
  sessionHandoff(@Body() dto: HandoffDto) {
    return this.authService.handleSessionHandoff(dto);
  }

  // Silent JWT rotation. Public like handoff (the token may already be expired,
  // so it cannot pass JwtAuthGuard). Throttled hard: it is a token-minting oracle.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  async refresh(@Req() req: any) {
    const auth = req.headers?.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      throw new HttpException(
        { message: 'Token tidak valid', code: 'INVALID_TOKEN' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.authService.refresh(token);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return this.authService.me(req.user);
  }

  // Server-side logout: JWT-guarded (a valid bearer identifies the session
  // owner). Clears the server session so the token can no longer be refreshed.
  // `req.user` is set by JwtAuthGuard before this runs (same contract as me()).
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(@Req() req: any) {
    return this.authService.logout(req.user.sub);
  }
}