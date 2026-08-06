import { Controller, Get, HttpException, HttpStatus, Param, Query, Req, UseGuards } from '@nestjs/common';
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
  async getCourses(@Req() req: any) {
    const session = await this.sessionStore.get(req.user?.sub);
    if (!session?.kulonCookie) {
      throw new HttpException(
        { message: 'Kulon session belum ada — silakan login ulang via SSO' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const sesskey = await this.getSesskey(session.kulonCookie);
    return this.kulonService.getCourses(session.kulonCookie, sesskey);
  }

  @Get('assignments/all')
  async getAllAssignments(@Req() req: any) {
    const session = await this.sessionStore.get(req.user?.sub);
    if (!session?.kulonCookie) {
      throw new HttpException(
        { message: 'Kulon session belum ada — silakan login ulang via SSO' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const sesskey = await this.getSesskey(session.kulonCookie);
    return this.kulonService.getAllAssignments(session.kulonCookie, sesskey);
  }

  @Get('assignments')
  async getAssignments(@Req() req: any) {
    const session = await this.sessionStore.get(req.user?.sub);
    if (!session?.kulonCookie) {
      throw new HttpException(
        { message: 'Kulon session belum ada — silakan login ulang via SSO' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const sesskey = await this.getSesskey(session.kulonCookie);
    return this.kulonService.getAssignments(session.kulonCookie, sesskey);
  }

  @Get('assignments/:id/detail')
  async getAssignmentDetail(@Param('id') id: string, @Query('cmid') cmid: string, @Req() req: any) {
    const session = await this.sessionStore.get(req.user?.sub);
    if (!session?.kulonCookie) {
      throw new HttpException(
        { message: 'Kulon session belum ada — silakan login ulang via SSO' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const assignmentId = Number(id);
    const courseModuleId = Number(cmid);
    if (!Number.isInteger(assignmentId) || !Number.isInteger(courseModuleId) || assignmentId <= 0) {
      throw new HttpException(
        { message: 'Detail tugas tidak ditemukan' },
        HttpStatus.NOT_FOUND,
      );
    }
    await this.getSesskey(session.kulonCookie);
    try {
      return await this.kulonService.getAssignmentDetail(
        session.kulonCookie,
        assignmentId,
        courseModuleId,
      );
    } catch (e) {
      if ((e as Error).message === 'ASSIGNMENT_NOT_FOUND') {
        throw new HttpException(
          { message: 'Detail tugas tidak ditemukan' },
          HttpStatus.NOT_FOUND,
        );
      }
      throw e;
    }
  }

  @Get('courses/:id/content')
  async getCourseContent(@Param('id') id: string, @Req() req: any) {
    const session = await this.sessionStore.get(req.user?.sub);
    if (!session?.kulonCookie) {
      throw new HttpException(
        { message: 'Kulon session belum ada — silakan login ulang via SSO' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const courseId = Number(id);
    if (!Number.isInteger(courseId) || courseId <= 0) {
      throw new HttpException({ message: 'Mata kuliah tidak ditemukan' }, HttpStatus.NOT_FOUND);
    }
    const sesskey = await this.getSesskey(session.kulonCookie);
    try {
      return await this.kulonService.getCourseContent(session.kulonCookie, sesskey, courseId);
    } catch (e) {
      if ((e as Error).message === 'COURSE_NOT_FOUND') {
        throw new HttpException({ message: 'Mata kuliah tidak ditemukan' }, HttpStatus.NOT_FOUND);
      }
      throw e;
    }
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
    try {
      return this.kulonService.parseSesskey(html);
    } catch (e) {
      // No sesskey means the page is a login page — either Moodle's own
      // (kulon2.undip.ac.id/login/index.php) or a Microsoft OIDC redirect
      // landing (login.microsoftonline.com) after the stale MoodleSession.
      // Surface as a clean 401 so the frontend prompts re-login instead of a
      // raw 500.
      if (this.isLoginPage(res.url, html)) {
        throw new HttpException(
          { message: 'Session Kulon expired — silakan login ulang via SSO' },
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw e;
    }
  }

  /**
   * A page that reached getSesskey without a parseable sesskey is a login
   * page (Moodle login or Microsoft OIDC redirect). Detect via the final URL
   * or by the absence of the sesskey input.
   */
  private isLoginPage(finalUrl: string, html: string): boolean {
    if (/(login\.microsoftonline\.com|\/login\/)/i.test(finalUrl)) return true;
    return !/name="sesskey"/.test(html);
  }
}