import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionStore } from './session-store';
import { InMemorySessionStore } from './in-memory-session.store';

@Module({
  providers: [
    {
      provide: SessionStore,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new InMemorySessionStore(Number(config.get('SESSION_TTL_MS'))),
    },
  ],
  exports: [SessionStore],
})
export class SessionModule {}
