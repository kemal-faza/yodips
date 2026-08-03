import { Controller, Get, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
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
      throw new HttpException(
        { message: 'Kulon session belum ada — silakan login ulang via SSO' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const sesskey = await this.getSesskey(session.kulonCookie);
    return this.kulonService.getCourses(session.kulonCookie, sesskey);
  }

  @Get('assignments')
  async getAssignments() {
    const session = this.sessionStore.get();
    if (!session?.kulonCookie) {
      throw new HttpException(
        { message: 'Kulon session belum ada — silakan login ulang via SSO' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const sesskey = await this.getSesskey(session.kulonCookie);
    return this.kulonService.getAssignments(session.kulonCookie, sesskey);
  }

  /**
   * Fetch the Moodle sesskey from the Kulon page. A stale/expired kulon cookie
   * makes Kulon redirect-loop (Moodle `/my/` <-> `/login/`), which surfaces as
   * `fetch failed: redirect count exceeded`. Map that to a clear 401 so the
   * frontend can prompt a re-login instead of showing a raw 500.
   */
  private async getSesskey(kulonCookie: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch('https://kulon2.undip.ac.id/my/', {
        headers: { Cookie: kulonCookie },
        redirect: 'follow',
      });
    } catch (e) {
      if ((e as Error)?.cause && /redirect count exceeded/i.test(String((e as Error).cause))) {
        throw new HttpException(
          { message: 'Session Kulon expired — silakan login ulang via SSO' },
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw new HttpException(
        `Gagal terhubung ke Kulon: ${(e as Error).message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (!res.ok) {
      throw new HttpException(
        `Kulon merespons ${res.status} — silakan login ulang via SSO`,
        HttpStatus.UNAUTHORIZED,
      );
    }
    const html = await res.text();
    return this.kulonService.parseSesskey(html);
  }
}