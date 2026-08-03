import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KulonController } from './kulon.controller';
import { KulonService } from './kulon.service';

@Module({
  imports: [AuthModule],
  controllers: [KulonController],
  providers: [KulonService],
  exports: [KulonService],
})
export class KulonModule {}