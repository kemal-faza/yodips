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

/** Express-style request once JwtAuthGuard has attached the parsed JWT claims. */
interface AuthedRequest {
  user?: { sub?: string; [k: string]: unknown };
}

@UseGuards(JwtAuthGuard)
@Controller('api/siap')
export class SiapController {
  constructor(private readonly siapService: SiapService) {}

  @Get('profile')
  getProfile(@Req() req: AuthedRequest) {
    return this.siapService.getProfile(req.user?.sub);
  }

  @Get('irs')
  getIrs(@Req() req: AuthedRequest) {
    return this.siapService.getIrs(req.user?.sub);
  }

  @Get('khs')
  getKhs(@Req() req: AuthedRequest) {
    return this.siapService.getKhs(req.user?.sub);
  }

  @Get('lecturers')
  getLecturers(@Req() req: AuthedRequest) {
    return this.siapService.getLecturers(req.user?.sub);
  }

  @Get('notifications')
  getNotifications(@Req() req: AuthedRequest) {
    return this.siapService.getNotifications(req.user?.sub);
  }

  @Get('jadwal')
  getJadwal(@Req() req: AuthedRequest) {
    return this.siapService.getJadwal(req.user?.sub);
  }

  @Get('absen')
  getAbsen(@Req() req: AuthedRequest) {
    return this.siapService.getAbsen(req.user?.sub);
  }

  @Get('kehadiran/:id')
  async getKehadiran(@Param('id') id: string, @Req() req: AuthedRequest) {
    if (!/^\d+$/.test(id)) {
      throw new HttpException(
        { message: 'ID kehadiran tidak valid' },
        HttpStatus.BAD_REQUEST,
      );
    }
    return await this.siapService.getKehadiran(req.user?.sub, id);
  }

  @Post('kehadiran')
  async markKehadiran(@Req() req: AuthedRequest, @Body() body: { token?: string }) {
    if (!body?.token) {
      throw new HttpException(
        { message: 'token QR wajib diisi' },
        HttpStatus.BAD_REQUEST,
      );
    }
    return await this.siapService.markKehadiran(req.user?.sub, body.token);
  }

  @Post('notifications/:id/unread')
  markNotification(@Param('id') id: string, @Req() req: AuthedRequest) {
    if (!/^\d+$/.test(id)) {
      throw new HttpException(
        { message: 'ID notifikasi tidak valid' },
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.siapService.markNotification(req.user?.sub, id);
  }
}
