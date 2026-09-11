import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { isSessionRef } from '../session/session-store';
import { sessionDead } from '../session/live-session';

interface AuthedRequest {
  user?: { sub?: string; sessionGeneration?: unknown; [k: string]: unknown };
}

@UseGuards(JwtAuthGuard)
@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  async getDashboard(@Req() req: AuthedRequest) {
    if (!isSessionRef(req.user)) {
      throw sessionDead();
    }
    return this.dashboardService.getDashboard({ sub: req.user.sub, sessionGeneration: req.user.sessionGeneration });
  }
}
