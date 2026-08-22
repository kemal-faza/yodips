import {
  Body,
  Controller,
  Delete,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationStore } from './notification-store';
import { RegisterDeviceDto } from './dto/register-device.dto';

interface AuthedRequest {
  user?: { sub?: string };
}

@UseGuards(JwtAuthGuard)
@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly store: NotificationStore) {}

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
}
