import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers?.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    // Throw 401 (unauthenticated) instead of returning false (which Nest maps
    // to 403 Forbidden): clients key their silent-refresh / re-login flows off
    // the 401 status, and 401 is the semantically correct auth-failure code.
    if (!token) throw new UnauthorizedException();
    try {
      req.user = await this.jwt.verifyAsync(token, {
        secret: this.config.get<string>('JWT_SECRET'),
        // Pin the algorithm and require issuer/audience so a forged/mismatched
        // token (e.g. one signed with a different alg or for another audience)
        // is rejected outright rather than relying on default verification.
        algorithms: ['HS256'],
        issuer: 'yodips',
        audience: 'yodips-web',
      });
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}