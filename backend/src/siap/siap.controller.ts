import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { SiapService } from './siap.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SessionRef, isSessionRef } from '../session/session-store';
import { sessionDead } from '../session/live-session';

/** Express-style request once JwtAuthGuard has attached the parsed JWT claims. */
interface AuthedRequest {
  user?: { sub?: string; sessionGeneration?: unknown; [k: string]: unknown };
}

function requireSessionRef(req: AuthedRequest): SessionRef {
  if (!isSessionRef(req.user)) {
    throw sessionDead();
  }
  return { sub: req.user.sub, sessionGeneration: req.user.sessionGeneration };
}

@UseGuards(JwtAuthGuard)
@Controller('api/siap')
export class SiapController {
  constructor(
    private readonly siapService: SiapService,
    private readonly config: ConfigService,
  ) {}

  @Get('profile')
  async getProfile(@Req() req: AuthedRequest) {
    return this.siapService.getProfile(requireSessionRef(req));
  }

  @Get('irs')
  async getIrs(@Req() req: AuthedRequest) {
    return this.siapService.getIrs(requireSessionRef(req));
  }

  @Get('khs')
  async getKhs(@Req() req: AuthedRequest) {
    return this.siapService.getKhs(requireSessionRef(req));
  }

  @Get('lecturers')
  async getLecturers(@Req() req: AuthedRequest) {
    return this.siapService.getLecturers(requireSessionRef(req));
  }

  @Get('notifications')
  async getNotifications(@Req() req: AuthedRequest) {
    return this.siapService.getNotifications(requireSessionRef(req));
  }

  @Get('jadwal')
  async getJadwal(@Req() req: AuthedRequest) {
    return this.siapService.getJadwal(requireSessionRef(req));
  }

  @Get('absen')
  async getAbsen(@Req() req: AuthedRequest) {
    return this.siapService.getAbsen(requireSessionRef(req));
  }

  @Get('kehadiran/:id')
  async getKehadiran(@Param('id') id: string, @Req() req: AuthedRequest) {
    if (!/^\d+$/.test(id)) {
      throw new HttpException(
        { message: 'ID kehadiran tidak valid' },
        HttpStatus.BAD_REQUEST,
      );
    }
    return await this.siapService.getKehadiran(requireSessionRef(req), id);
  }

  @Get('nilai/:id/detail')
  async getNilaiDetail(@Param('id') id: string, @Req() req: AuthedRequest) {
    // Full SIAP detail-id: `<id_irs>#<nim>#<kode>` (contains `#`).
    if (!/^\d+(?:#\d+){1,2}$/.test(id)) {
      throw new HttpException(
        { message: 'ID nilai tidak valid' },
        HttpStatus.BAD_REQUEST,
      );
    }
    return await this.siapService.getNilaiDetail(requireSessionRef(req), id);
  }

  @Post('kehadiran')
  async markKehadiran(@Req() req: AuthedRequest, @Body() body: { token?: string }) {
    if (!body?.token) {
      throw new HttpException(
        { message: 'token QR wajib diisi' },
        HttpStatus.BAD_REQUEST,
      );
    }
    return await this.siapService.markKehadiran(requireSessionRef(req), body.token);
  }

  @Post('notifications/:id/unread')
  async markNotification(@Param('id') id: string, @Req() req: AuthedRequest) {
    if (!/^\d+$/.test(id)) {
      throw new HttpException(
        { message: 'ID notifikasi tidak valid' },
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.siapService.markNotification(requireSessionRef(req), id);
  }

  /**
   * Dev-only equality harness for the A2 migration: runs BOTH the legacy cookie
   * scrape and the token path on the same session and returns the set diff.
   * Fails closed in production; removed once the equality gate passes.
   */
  @Get('dev/lecturers-compare')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async devCompareLecturers(
    @Req() req: AuthedRequest,
    @Query('staleSim') staleSim?: string,
  ) {
    if ((this.config.get<string>('NODE_ENV') ?? '') === 'production') {
      throw new HttpException(
        { message: 'Hanya tersedia di development' },
        HttpStatus.FORBIDDEN,
      );
    }
    return this.siapService.compareLecturers(requireSessionRef(req), {
      staleSim: staleSim === '1',
    });
  }
}
