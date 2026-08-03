import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.identity, dto.password);
  }

  @Post('sso/capture')
  captureSsoSession() {
    return this.authService.captureSsoSession();
  }

  @Get('microsoft/login')
  microsoftLogin() {
    return this.authService.getMicrosoftAuthUrl();
  }

  @Get('microsoft/callback')
  microsoftCallback(@Query('code') code: string) {
    return this.authService.handleMicrosoftCallback(code);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return this.authService.me(req.user);
  }
}