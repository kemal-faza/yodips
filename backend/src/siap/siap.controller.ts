import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
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
    return this.siapService.getProfile(cookie, req.user?.sub);
  }

  @Get('irs')
  async getIrs(@Req() req: any) {
    const cookie = await this.requireSiapCookie(req);
    return this.siapService.getIrs(cookie, req.user?.sub);
  }

  @Get('khs')
  async getKhs(@Req() req: any) {
    const cookie = await this.requireSiapCookie(req);
    return this.siapService.getKhs(cookie, req.user?.sub);
  }

  @Get('lecturers')
  async getLecturers(@Req() req: any) {
    const cookie = await this.requireSiapCookie(req);
    return this.siapService.getLecturers(cookie);
  }

  @Get('notifications')
  async getNotifications(@Req() req: any) {
    const cookie = await this.requireSiapCookie(req);
    return this.siapService.getNotifications(cookie);
  }

  @Get('jadwal')
  async getJadwal(@Req() req: any) {
    const cookie = await this.requireSiapCookie(req);
    return this.siapService.getJadwal(cookie);
  }

  @Get('kehadiran/:id')
  async getKehadiran(@Param('id') id: string, @Req() req: any) {
    const cookie = await this.requireSiapCookie(req);
    return this.siapService.getKehadiran(cookie, id);
  }

  @Post('kehadiran')
  async markKehadiran(@Req() req: any, @Body() body: { token?: string }) {
    const cookie = await this.requireSiapCookie(req);
    if (!body?.token) {
      throw new HttpException(
        { message: 'token QR wajib diisi' },
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.siapService.markKehadiran(cookie, body.token);
  }

  @Post('notifications/:id/unread')
  async markNotification(@Param('id') id: string, @Req() req: any) {
    const cookie = await this.requireSiapCookie(req);
    return this.siapService.markNotification(cookie, id);
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
