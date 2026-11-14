import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SessionStore } from '../session/session-store';
import {
  isClientId,
  isSessionGeneration,
  LEGACY_CLIENT_ID,
} from '../session/session-contract';
import { readLiveSession, sessionDead } from '../session/live-session';
import { ERROR_CODES } from '../common/error-codes';
import { USER_MESSAGES } from '../common/user-messages';

/**
 * A rejected request keeps the 401 status and the ABSENCE of a machine code
 * (clients probe a refresh to tell "invalid JWT" from "upstream stale"), but
 * the body copy is human — never the framework's bare `Unauthorized`.
 */
function unauthenticated(): UnauthorizedException {
  return new UnauthorizedException({ message: USER_MESSAGES.SESSION_ENDED });
}

/**
 * The token is well-formed but its device claim can never name a stored
 * session (missing/invalid `clientId` once the legacy fallback is off). This is
 * an invalid-token case, not a live-but-stale session: clients must re-login
 * instead of renewing an upstream cookie.
 */
function invalidToken(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'Token tidak valid',
    code: ERROR_CODES.INVALID_TOKEN,
  });
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sessionStore: SessionStore,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers?.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    // Throw 401 (unauthenticated) instead of returning false (which Nest maps
    // to 403 Forbidden): clients key their silent-refresh / re-login flows off
    // the 401 status, and 401 is the semantically correct auth-failure code.
    if (!token) throw unauthenticated();
    let payload: {
      sub?: unknown;
      clientId?: unknown;
      sessionGeneration?: unknown;
      via?: unknown;
    };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get<string>('JWT_SECRET'),
        // Pin the algorithm and require issuer/audience so a forged/mismatched
        // token (e.g. one signed with a different alg or for another audience)
        // is rejected outright rather than relying on default verification.
        algorithms: ['HS256'],
        issuer: 'yodips',
        audience: 'yodips-web',
      });
    } catch {
      throw unauthenticated(); // 401 without a code (existing behavior)
    }
    // Claim shape: non-empty string sub + 32-hex sessionGeneration.
    // A legacy/no-claim token fails here → bare 401.
    const sub = typeof payload?.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
    const generation = payload?.sessionGeneration;
    if (!sub || !isSessionGeneration(generation)) throw unauthenticated();
    // Resolve the device ID with the P1 legacy fallback. Only a real client ID
    // is trusted as-is; `legacy` is a reserved stored value, so a signed claim
    // of `legacy` is usable only while the rollout flag is on. Once the flag is
    // off, a missing/invalid claim is an invalid token (re-login), never a
    // silent per-user record lookup.
    const rawClientId = payload?.clientId;
    const legacyEnabled = this.config.get<boolean>('SESSION_LEGACY_CLIENT_ENABLED') === true;
    const clientId =
      typeof rawClientId === 'string' && isClientId(rawClientId)
        ? rawClientId
        : legacyEnabled
          ? LEGACY_CLIENT_ID
          : null;
    if (!clientId) throw invalidToken();
    // Presence read lives OUTSIDE the verify try so SESSION_DEAD is not
    // swallowed into a bare 401. The one guarded read: the exact token
    // device + generation must still be live — a B-replacement after mint is a
    // miss (SESSION_DEAD), closing the guard→service TOCTOU at its source
    // (services re-validate with the same ref before touching cookies).
    const record = await readLiveSession(this.sessionStore, {
      sub,
      clientId,
      sessionGeneration: generation,
    });
    if (!record) {
      throw sessionDead();
    }
    // Claims are spread FIRST so the raw (possibly malformed) `clientId` claim
    // can never overwrite the normalized device ID the ref was validated with.
    req.user = { ...payload, sub, clientId, sessionGeneration: generation };
    return true;
  }
}
