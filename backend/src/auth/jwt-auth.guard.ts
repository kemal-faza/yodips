import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SessionStore } from '../session/session-store';

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
    if (!token) throw new UnauthorizedException();
    let payload: { sub?: unknown; sessionCapturedAt?: unknown; via?: unknown };
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
      throw new UnauthorizedException(); // bare 401 (existing behavior)
    }
    // Claim shape: non-empty string sub + finite numeric sessionCapturedAt.
    // A legacy/no-claim token fails here → bare 401.
    const sub = typeof payload?.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
    const generation = payload?.sessionCapturedAt;
    const genOk = typeof generation === 'number' && Number.isFinite(generation);
    if (!sub || !genOk) throw new UnauthorizedException();
    // Presence read lives OUTSIDE the verify try so SESSION_DEAD is not
    // swallowed into a bare 401.
    const record = await this.sessionStore.get(sub);
    if (!record) {
      throw new UnauthorizedException({ code: 'SESSION_DEAD', message: 'Sesi berakhir. Silakan login ulang' });
    }
    if (record.capturedAt !== generation) {
      // An old-generation token (minted before the user's last re-login) must
      // not pass against the newer live session.
      throw new UnauthorizedException({ code: 'SESSION_DEAD', message: 'Sesi berakhir. Silakan login ulang' });
    }
    req.user = { sub, sessionCapturedAt: generation, ...payload };
    return true;
  }
}
