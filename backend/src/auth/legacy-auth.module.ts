import { Module, type DynamicModule } from '@nestjs/common';
import { MicrosoftModule } from '../microsoft/microsoft.module';
import { PlaywrightModule } from '../playwright/playwright.module';
import { SSOModule } from '../sso/sso.module';
import { SessionModule } from '../session/session.module';
import { KulonModule } from '../kulon/kulon.module';
import { SiapModule } from '../siap/siap.module';
import { AuthModule } from './auth.module';
import { LegacyAuthController } from './legacy-auth.controller';
import { LegacyAuthService } from './legacy-auth.service';

@Module({})
export class LegacyAuthModule {
  static forRuntime(
    nodeEnv = process.env.NODE_ENV ?? 'development',
  ): DynamicModule {
    if (nodeEnv !== 'development' && nodeEnv !== 'test') {
      return { module: LegacyAuthModule };
    }

    return {
      module: LegacyAuthModule,
      imports: [
        AuthModule,
        SSOModule,
        SessionModule,
        KulonModule,
        SiapModule,
        MicrosoftModule,
        PlaywrightModule,
      ],
      controllers: [LegacyAuthController],
      providers: [LegacyAuthService],
    };
  }
}
