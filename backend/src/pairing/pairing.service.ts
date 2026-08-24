import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SessionStore } from '../session/session-store';
import { generatePairingCode, hashPairingCode, normalizePairingCode } from './pairing-code';
import { PairingStore } from './pairing-store';

const DEFAULT_PAIRING_TTL_MS = 300_000; // 5 menit

@Injectable()
export class PairingService {
  private readonly logger = new Logger(PairingService.name);

  constructor(
    private readonly pairingStore: PairingStore,
    private readonly sessionStore: SessionStore,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async requestPairing(
    sub: string,
  ): Promise<{ code: string; qrUrl: string; expiresAt: number }> {
    const session = await this.sessionStore.get(sub);
    if (!session) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const ttlMs = Number(
      this.config.get<number>('PAIRING_TTL_MS') ?? DEFAULT_PAIRING_TTL_MS,
    );
    const code = generatePairingCode();
    const expiresAt = Date.now() + ttlMs;
    await this.pairingStore.set(hashPairingCode(code), { sub, expiresAt }, ttlMs);
    const base = this.config.get<string>('FRONTEND_BASE_URL') ?? '';
    return { code, qrUrl: `${base}/login?pair=${code}`, expiresAt };
  }

  async consume(
    codeRaw: string,
  ): Promise<{ accessToken: string; hasKulon: boolean; hasSiap: boolean }> {
    const code = normalizePairingCode(codeRaw ?? '');
    const record =
      code.length > 0 ? await this.pairingStore.consume(hashPairingCode(code)) : null;
    if (!record) {
      // Pesan identik untuk miss & expired: jangan sediakan oracle.
      throw new HttpException(
        { message: 'Kode tidak valid atau sudah kedaluwarsa', code: 'INVALID_CODE' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const session = await this.sessionStore.get(record.sub);
    if (!session) {
      this.logger.warn(`Pairing consumed for dead session ${record.sub}`);
      throw new HttpException(
        {
          message:
            'Sesi di perangkat lama sudah berakhir. Login ulang di sana, lalu minta kode baru',
          code: 'SESSION_DEAD',
        },
        HttpStatus.CONFLICT,
      );
    }
    // via='pair' → AuthService.me() tidak mensyaratkan ssoCookie (lihat me()).
    const accessToken = await this.jwt.signAsync({ sub: record.sub, via: 'pair' });
    return {
      accessToken,
      hasKulon: !!session.kulonCookie,
      hasSiap: !!session.siapCookie,
    };
  }
}
