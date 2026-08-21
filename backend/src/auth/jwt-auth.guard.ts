import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
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
    if (!token) return false;
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
      return false;
    }
  }
}