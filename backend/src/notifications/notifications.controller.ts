import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MAX_WEB_SUBSCRIPTIONS, NotificationStore } from './notification-store';
import { NotificationsPoller } from './poller.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { WebDeviceDto } from './dto/web-device.dto';
import { WebPushService } from './web-push.service';

interface AuthedRequest {
  user?: { sub?: string };
}

@UseGuards(JwtAuthGuard)
@Controller('api/notifications')
export class NotificationsController {
  constructor(
    private readonly store: NotificationStore,
    private readonly poller: NotificationsPoller,
    private readonly config: ConfigService,
    private readonly webPush: WebPushService,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('device')
  async register(@Req() req: AuthedRequest, @Body() dto: RegisterDeviceDto) {
    const sub = req.user?.sub;
    if (!sub) {
      throw new HttpException(
        { message: 'Token tidak valid' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    await this.store.addDeviceToken(sub, dto.token);
    return { ok: true };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Delete('device')
  async unregister(@Req() req: AuthedRequest, @Body() dto: RegisterDeviceDto) {
    const sub = req.user?.sub;
    if (!sub) {
      throw new HttpException(
        { message: 'Token tidak valid' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    await this.store.removeDeviceToken(sub, dto.token);
    return { ok: true };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('web-device')
  async registerWeb(@Req() req: AuthedRequest, @Body() dto: WebDeviceDto) {
    const sub = req.user?.sub;
    if (!sub) {
      throw new HttpException(
        { message: 'Token tidak valid' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const cap =
      this.config.get<number>('WEB_PUSH_MAX_SUBSCRIPTIONS') ?? MAX_WEB_SUBSCRIPTIONS;
    const status = await this.store.addWebSubscription(
      sub,
      {
        endpoint: dto.endpoint,
        p256dh: dto.p256dh,
        auth: dto.auth,
      },
      cap,
    );
    if (status === 'cap-reached') {
      throw new HttpException(
        {
          message: 'Terlalu banyak subscription push untuk akun ini',
          code: 'WEB_PUSH_CAP_REACHED',
        },
        HttpStatus.CONFLICT,
      );
    }
    // 'added' and 'duplicate' are both success: the SPA/PWA re-registers the
    // same subscription on every login, so duplicate must stay idempotent.
    return { ok: true };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Delete('web-device')
  async removeWeb(@Req() req: AuthedRequest, @Body() dto: WebDeviceDto) {
    const sub = req.user?.sub;
    if (!sub) {
      throw new HttpException(
        { message: 'Token tidak valid' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    await this.store.removeWebSubscription(sub, {
      endpoint: dto.endpoint,
      p256dh: dto.p256dh,
      auth: dto.auth,
    });
    return { ok: true };
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('vapid-public-key')
  async vapidPublicKey() {
    return { publicKey: this.webPush.publicKey };
  }

  /**
   * HANYA development: jalankan satu siklus polling sinkron (verifikasi E2E).
   * `deadlineWindowHours` mengoverride jendela 24 jam — deterministik saat
   * live-test tanpa menunggu tugas benar-benar dekat deadline.
   */
  @Post('dev/run-cycle')
  async devRunCycle(@Query('deadlineWindowHours') hours?: string) {
    if ((this.config.get<string>('NODE_ENV') ?? '') === 'production') {
      throw new HttpException(
        { message: 'Hanya tersedia di development' },
        HttpStatus.FORBIDDEN,
      );
    }
    const n = hours !== undefined && hours !== '' ? Number(hours) : NaN;
    const windowMs = Number.isFinite(n) ? n * 3600 * 1000 : undefined;
    return this.poller.runCycle(Date.now(), windowMs);
  }
}
