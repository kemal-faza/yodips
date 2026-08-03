import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';
import { SSOModule } from './sso/sso.module';
import { AuthModule } from './auth/auth.module';
import { KulonModule } from './kulon/kulon.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: ['.env'],
    }),
    SSOModule,
    AuthModule,
    KulonModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
