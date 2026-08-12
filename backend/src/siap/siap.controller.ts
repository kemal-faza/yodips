import { Controller, Get, HttpException, HttpStatus, Req, UseGuards } from '@nestjs/common';
import { SiapService } from './siap.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SessionStore } from '../session/session-store';

@UseGuards(JwtAuthGuard)
@Controller('api/siap')
export class SiapController {
  constructor(
    private readonly siapService: SiapService,
    private readonly sessionStore: SessionStore,
  ) {}

  @Get('profile')
  async getProfile(@Req() req: any) {
    const cookie = await this.requireSiapCookie(req);
    return this.siapService.getProfile(cookie);
  }

  @Get('irs')
  async getIrs(@Req() req: any) {
    const cookie = await this.requireSiapCookie(req);
    return this.siapService.getIrs(cookie);
  }

  @Get('khs')
  async getKhs(@Req() req: any) {
    const cookie = await this.requireSiapCookie(req);
    return this.siapService.getKhs(cookie);
  }

  @Get('lecturers')
  async getLecturers(@Req() req: any) {
    const cookie = await this.requireSiapCookie(req);
    return this.siapService.getLecturers(cookie);
  }

  private async requireSiapCookie(req: any): Promise<string> {
    const session = await this.sessionStore.get(req.user?.sub);
    if (!session?.siapCookie) {
      throw new HttpException(
        { message: 'SIAP session belum ada — silakan login ulang via SSO' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return session.siapCookie;
  }
}