import { Module } from '@nestjs/common';
import { ObservabilityModule } from '../observability/observability.module';
import { SSOTicketService } from './ticket.service';
import { SSOAuthService } from './sso-auth.service';

@Module({
  imports: [ObservabilityModule],
  providers: [SSOTicketService, SSOAuthService],
  exports: [SSOTicketService, SSOAuthService],
})
export class SSOModule {}
