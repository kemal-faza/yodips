import { Module } from '@nestjs/common';
import { SSOTicketService } from './ticket.service';
import { SSOAuthService } from './sso-auth.service';

@Module({
  providers: [SSOTicketService, SSOAuthService],
  exports: [SSOTicketService, SSOAuthService],
})
export class SSOModule {}