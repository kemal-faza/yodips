import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ERROR_CODES } from '../common/error-codes';
import { SessionRef, SessionStore } from '../session/session-store';
import {
  generateSessionGeneration,
  isClientId,
  isSessionGeneration,
  isStoredClientId,
  LEGACY_CLIENT_ID,
} from '../session/session-contract';
import { readLiveSession, sessionDead } from '../session/live-session';
import { generatePairingCode, hashPairingCode, normalizePairingCode } from './pairing-code';
import { PairingStore } from './pairing-store';

const DEFAULT_PAIRING_TTL_MS = 600_000; // 10 menit

/** Device-specific copy for a dead/replaced session on the pairing consume path. */
const PAIRING_DEAD_MESSAGE =
  'Sesi di perangkat lama sudah berakhir. Login ulang di sana, lalu minta kode baru';

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
    const session = await readLiveSession(this.sessionStore, ref);
    if (!session) {
      throw sessionDead();
    }
    const ttlMs = Number(
      this.config.get<number>('PAIRING_TTL_MS') ?? DEFAULT_PAIRING_TTL_MS,
    );
    const code = generatePairingCode();
    const expiresAt = Date.now() + ttlMs;
    await this.pairingStore.set(
      hashPairingCode(code),
      {
        sub: ref.sub,
        clientId: ref.clientId,
        sessionGeneration: ref.sessionGeneration,
        expiresAt,
      },
      ttlMs,
    );
    const base = this.config.get<string>('FRONTEND_BASE_URL') ?? '';
    return { code, qrUrl: `${base}/login?pair=${code}`, expiresAt };
  }

  async consume(
    codeRaw: string,
    newClientIdRaw?: string,
  ): Promise<{ accessToken: string; hasKulon: boolean; hasSiap: boolean }> {
    // Validate the consuming device BEFORE touching the code: a malformed
    // client ID must never burn a single-use pairing code.
    const newClientId = this.resolveNewClientId(newClientIdRaw);
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
    const issuedGeneration = isSessionGeneration(outcome.record.sessionGeneration)
      ? outcome.record.sessionGeneration
      : null;
    // Old records predate per-device keys: a missing clientId is the reserved
    // legacy device only while the rollout flag is on. A present-but-malformed
    // value is always dead — never silently treated as legacy.
    const sourceClientId = this.resolveSourceClientId(outcome.record.clientId);
    const source =
      issuedGeneration && sourceClientId
        ? await readLiveSession(this.sessionStore, {
            sub: outcome.record.sub,
            clientId: sourceClientId,
            sessionGeneration: issuedGeneration,
          })
        : null;
    if (!source) {
      // Dead/absent (including a legacy record with no issuance binding) OR a
      // replacement (re-login) between request and consume: the issuing
      // generation is no longer live. Never re-bind to the replacement.
      this.logger.warn('Pairing consumed for dead/replaced session');
      throw sessionDead({ message: PAIRING_DEAD_MESSAGE, status: HttpStatus.CONFLICT });
    }
    // Cap live devices per NIM: a NEW device evicts the oldest capturedAt
    // record; re-pairing an existing device replaces its own record and never
    // counts against the cap. Never evict a different user's record.
    const existing = await this.sessionStore.listBySub(source.identity);
    const configuredMax = Number(this.config.get('SESSION_MAX_PER_USER') ?? 10);
    const max =
      Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 10;
    const hasCurrent = existing.some((s) => s.clientId === newClientId);
    if (!hasCurrent && existing.length >= max) {
      const oldest = [...existing].sort((a, b) => a.capturedAt - b.capturedAt)[0];
      if (oldest) {
        await this.sessionStore.clearIfGeneration({
          sub: oldest.identity,
          clientId: oldest.clientId,
          sessionGeneration: oldest.sessionGeneration,
        });
      }
    }
    // The paired device gets an INDEPENDENT record (its own generation and
    // capture timestamp); the source device is never touched.
    const paired = {
      ...source,
      clientId: newClientId,
      capturedAt: Date.now(),
      sessionGeneration: generateSessionGeneration(),
    };
    await this.sessionStore.set(paired);
    // via='pair' → AuthService.me() tidak mensyaratkan ssoCookie (lihat me()).
    const accessToken = await this.jwt.signAsync({
      sub: paired.identity,
      clientId: newClientId,
      via: 'pair',
      sessionGeneration: paired.sessionGeneration,
    });
    return {
      accessToken,
      hasKulon: !!paired.kulonCookie,
      hasSiap: !!paired.siapCookie,
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

  /** P1 rollout flag; both a validated boolean and a raw `'true'` enable it. */
  private legacyClientEnabled(): boolean {
    const raw = this.config.get<boolean | string>(
      'SESSION_LEGACY_CLIENT_ENABLED',
    );
    return raw === true || raw === 'true';
  }

  /**
   * The consuming device is client-controlled: an EXPLICIT malformed value (a
   * bad shape OR the reserved `legacy` sentinel) is rejected loudly and never
   * silently remapped. Only a missing/empty value falls back to `legacy` while
   * the rollout flag is on.
   */
  private resolveNewClientId(supplied: unknown): string {
    if (supplied !== undefined && supplied !== null && supplied !== '') {
      if (!isClientId(supplied)) {
        throw new HttpException(
          {
            message: 'clientId tidak valid',
            code: ERROR_CODES.INVALID_CLIENT_ID,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      return supplied;
    }
    if (this.legacyClientEnabled()) return LEGACY_CLIENT_ID;
    throw new HttpException(
      { message: 'clientId wajib diisi', code: ERROR_CODES.CLIENT_ID_REQUIRED },
      HttpStatus.BAD_REQUEST,
    );
  }

  /**
   * Stored/pairing-record client resolution. Old records (P1 rollout) have no
   * `clientId`: they map to the reserved legacy device only while the flag is
   * on; otherwise the pairing is dead. A present-but-malformed value is dead.
   */
  private resolveSourceClientId(stored: unknown): string | null {
    if (isStoredClientId(stored)) return stored;
    if (stored === undefined || stored === null || stored === '') {
      return this.legacyClientEnabled() ? LEGACY_CLIENT_ID : null;
    }
    return null;
  }
}
