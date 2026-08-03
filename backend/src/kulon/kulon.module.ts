import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SessionModule } from '../session/session.module';
import { KulonController } from './kulon.controller';
import { KulonService } from './kulon.service';

@Module({
  imports: [AuthModule, SessionModule],
  controllers: [KulonController],
  providers: [KulonService],
  exports: [KulonService],
})
export class KulonModule {}