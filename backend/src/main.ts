import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttp } from './http/configure-http';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Resolve the env-VALIDATED hop selector from Nest ConfigService (validateEnv
  // ran at ConfigModule registration: 0..2 @Min/@Max, default 0) and pass it
  // into configureHttp — the raw process.env value is never re-read here.
  const trustProxyHops = app.get(ConfigService).get<number>('TRUST_PROXY_HOPS', 0) as number;
  configureHttp(app, trustProxyHops);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
