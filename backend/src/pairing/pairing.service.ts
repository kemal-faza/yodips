import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SessionRef, SessionStore, isSessionRef } from '../session/session-store';
import { isSessionGeneration } from '../playwright/playwright-auth.service';
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
    ref: SessionRef,
  ): Promise<{ code: string; qrUrl: string; expiresAt: number }> {
    // Generation-qualified: the issuing JWT's exact generation is re-validated
    // against the LIVE record (TOCTOU-safe) and bound into the pairing record.
    if (!isSessionRef(ref)) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const session = await this.sessionStore.getIfGeneration(ref.sub, ref.sessionGeneration);
    if (!session || !isSessionGeneration(session.sessionGeneration)) {
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
    await this.pairingStore.set(
      hashPairingCode(code),
      { sub: ref.sub, sessionGeneration: ref.sessionGeneration, expiresAt },
      ttlMs,
    );
    const base = this.config.get<string>('FRONTEND_BASE_URL') ?? '';
    return { code, qrUrl: `${base}/login?pair=${code}`, expiresAt };
  }

  async consume(
    codeRaw: string,
  ): Promise<{ accessToken: string; hasKulon: boolean; hasSiap: boolean }> {
    const code = normalizePairingCode(codeRaw ?? '');
    const outcome =
      code.length > 0
        ? await this.pairingStore.consume(hashPairingCode(code))
        : ({ status: 'invalid' } as const);
    if (outcome.status === 'expired') {
      // Dibedakan dari INVALID atas permintaan UX (2026-08-25); oracle-leak-nya
      // kecil & terhitung tidak feasible — lihat PairingConsumeResult.
      throw new HttpException(
        { message: 'Kode sudah kedaluwarsa. Minta kode baru.', code: 'EXPIRED_CODE' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (outcome.status !== 'consumed') {
      // INVALID mencakup: tak pernah ada, sudah terpakai (single-use), format kosong.
      throw new HttpException(
        { message: 'Kode tidak valid atau sudah kedaluwarsa', code: 'INVALID_CODE' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const session = await this.sessionStore.getIfGeneration(
      outcome.record.sub,
      // Legacy records (pre-generation) carry no issuance binding → dead.
      isSessionGeneration(outcome.record.sessionGeneration)
        ? outcome.record.sessionGeneration
        : '__legacy__',
    );
    if (!session || !isSessionGeneration(session.sessionGeneration)) {
      this.logger.warn(`Pairing consumed for dead/legacy session ${outcome.record.sub}`);
      throw new HttpException(
        {
          message:
            'Sesi di perangkat lama sudah berakhir. Login ulang di sana, lalu minta kode baru',
          code: 'SESSION_DEAD',
        },
        HttpStatus.CONFLICT,
      );
    }
    if (session.sessionGeneration !== outcome.record.sessionGeneration) {
      // Replacement (re-login) between request and consume: the issuing
      // generation is no longer live. Never re-bind to the replacement.
      this.logger.warn(`Pairing consumed for replaced generation ${outcome.record.sub}`);
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
    const accessToken = await this.jwt.signAsync({
      sub: outcome.record.sub,
      via: 'pair',
      sessionGeneration: session.sessionGeneration,
    });
    return {
      accessToken,
      hasKulon: !!session.kulonCookie,
      hasSiap: !!session.siapCookie,
    };
  }

  /**
   * Status kode utk polling web (pemilik menanyakan kodenya sendiri).
   * Anti-oracle: viewerSub WAJIB cocok dengan pemilik record/tombstone —
   * kode milik orang lain dilaporkan persis seperti kode tak dikenal.
   */
  async statusFor(
    viewerSub: string,
    codeRaw: string,
  ): Promise<{ status: 'pending' | 'consumed' | 'invalid'; expiresAt?: number }> {
    const code = normalizePairingCode(codeRaw ?? '');
    if (code.length === 0) return { status: 'invalid' };
    const hash = hashPairingCode(code);

    const record = await this.pairingStore.get(hash);
    if (record) {
      if (record.sub !== viewerSub) return { status: 'invalid' };
      return { status: 'pending', expiresAt: record.expiresAt };
    }

    const consumedBy = await this.pairingStore.findConsumed(hash);
    if (consumedBy === viewerSub) return { status: 'consumed' };
    return { status: 'invalid' };
  }
}
