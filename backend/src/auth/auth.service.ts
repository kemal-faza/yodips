import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SSOAuthService } from '../sso/sso-auth.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly ssoAuth: SSOAuthService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(identity: string, password: string) {
    const baseUrl = this.config.get<string>('SSO_BASE_URL')!;
    const { cookie, redirectUrl } = await this.ssoAuth.login(
      baseUrl,
      identity,
      password,
    );
    const payload = { sub: identity, ssoSession: cookie, redirectUrl };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, ssoSession: cookie, redirectUrl };
  }

  async me(user: any) {
    return { sub: user?.sub, authenticated: true };
  }
}