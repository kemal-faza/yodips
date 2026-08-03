import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MicrosoftAuthService } from './microsoft-auth.service';

@Module({
  providers: [
    {
      provide: MicrosoftAuthService,
      inject: [ConfigService],
      useFactory: (c: ConfigService) =>
        new MicrosoftAuthService({
          tenantId: c.get<string>('MS_TENANT_ID')!,
          clientId: c.get<string>('MS_CLIENT_ID')!,
          clientSecret: c.get<string>('MS_CLIENT_SECRET')!,
          redirectUri: c.get<string>('MS_REDIRECT_URI')!,
        }),
    },
  ],
  exports: [MicrosoftAuthService],
})
export class MicrosoftModule {}