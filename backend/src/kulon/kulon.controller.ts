import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { KulonService } from './kulon.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('api/kulon')
export class KulonController {
  constructor(private readonly kulonService: KulonService) {}

  @Get('courses')
  async getCourses(@Req() req: any) {
    const msSession = req.user?.msSession;
    const sesskey = await this.getSesskey(msSession);
    return this.kulonService.getCourses(msSession, sesskey);
  }

  @Get('assignments')
  async getAssignments(@Req() req: any) {
    const msSession = req.user?.msSession;
    const sesskey = await this.getSesskey(msSession);
    return this.kulonService.getAssignments(msSession, sesskey);
  }

  private async getSesskey(msSession: string): Promise<string> {
    // Fetch the Kulon home page with the MS session to extract sesskey.
    const res = await fetch('https://kulon2.undip.ac.id/my/', {
      headers: { Cookie: msSession },
    });
    const html = await res.text();
    return this.kulonService.parseSesskey(html);
  }
}