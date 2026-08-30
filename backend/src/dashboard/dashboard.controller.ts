import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

interface AuthedRequest {
  user?: { sub?: string; [k: string]: unknown };
}

@UseGuards(JwtAuthGuard)
@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getDashboard(@Req() req: AuthedRequest) {
    return this.dashboardService.getDashboard(req.user?.sub);
  }
}
