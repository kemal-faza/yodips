import { Body, Controller, Get, HttpException, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { HandoffDto } from './dto/handoff.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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

  // Server-side logout. NOT JWT-guarded: an expired-but-valid bearer must still
  // be able to clear its session (the guard's exp check would reject it), so
  // the service verifies the signature itself (ignoreExpiration) and applies
  // the generation semantics (old-generation tokens never clear a newer
  // session; no-record logout is idempotent). Throttled hard like refresh.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('logout')
  async logout(@Req() req: any) {
    const auth = req.headers?.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      throw new HttpException(
        { message: 'Token tidak valid', code: 'INVALID_TOKEN' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.authService.logout(token);
  }
}
