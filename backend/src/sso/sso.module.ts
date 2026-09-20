import { Module } from '@nestjs/common';
import { ObservabilityModule } from '../observability/observability.module';
import { SSOTicketService } from './ticket.service';

@Module({
  imports: [ObservabilityModule],
  providers: [SSOTicketService],
  exports: [SSOTicketService],
})
export class SSOModule {}
