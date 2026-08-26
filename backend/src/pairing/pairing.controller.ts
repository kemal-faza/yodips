import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConsumeDto } from './dto/pair.dto';
import { PairingService } from './pairing.service';

@Controller('api/auth')
export class PairingController {
  constructor(private readonly pairing: PairingService) {}

  // Minta kode pairing: butuh JWT valid (kode terikat ke sesi token itu).
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('pair/request')
  request(@Req() req: any) {
    return this.pairing.requestPairing(req.user?.sub);
  }

  // Konsumsi kode ADALAH mekanisme login (menerbitkan JWT) → publik, throttle ketat.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('pair/consume')
  consume(@Body() dto: ConsumeDto) {
    return this.pairing.consume(dto.code);
  }

  // Status kode (polling web): read-only, tak mengonsumsi. Hanya pemilik
  // (sub dari JWT) yang bisa menanyakan kodenya sendiri — anti-oracle.
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('pair/status')
  status(@Req() req: any, @Query('code') code?: string) {
    return this.pairing.statusFor(req.user?.sub, code ?? '');
  }
}
