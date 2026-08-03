import { Module } from '@nestjs/common';
import { SessionStore } from './session-store';

@Module({
  providers: [SessionStore],
  exports: [SessionStore],
})
export class SessionModule {}