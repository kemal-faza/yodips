import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { KulonService } from './kulon.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SessionStore } from '../session/session-store';

@UseGuards(JwtAuthGuard)
@Controller('api/kulon')
export class KulonController {
  constructor(
    private readonly kulonService: KulonService,
    private readonly sessionStore: SessionStore,
  ) {}

  @Get('courses')
  async getCourses() {
    const session = this.sessionStore.get();
    if (!session?.kulonCookie) {
      throw new Error('No Kulon session — capture SSO session first');
    }
    const sesskey = await this.getSesskey(session.kulonCookie);
    return this.kulonService.getCourses(session.kulonCookie, sesskey);
  }

  @Get('assignments')
  async getAssignments() {
    const session = this.sessionStore.get();
    if (!session?.kulonCookie) {
      throw new Error('No Kulon session — capture SSO session first');
    }
    const sesskey = await this.getSesskey(session.kulonCookie);
    return this.kulonService.getAssignments(session.kulonCookie, sesskey);
  }

  private async getSesskey(kulonCookie: string): Promise<string> {
    const res = await fetch('https://kulon2.undip.ac.id/my/', {
      headers: { Cookie: kulonCookie },
    });
    const html = await res.text();
    return this.kulonService.parseSesskey(html);
  }
}