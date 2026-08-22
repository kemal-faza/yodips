import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { KulonService } from './kulon.service';
import { KulonSessionProbe } from './kulon-session-probe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SessionStore } from '../session/session-store';

@UseGuards(JwtAuthGuard)
@Controller('api/kulon')
export class KulonController {
  constructor(
    private readonly kulonService: KulonService,
    private readonly sessionStore: SessionStore,
    private readonly probe: KulonSessionProbe,
  ) {}

  @Get('courses')
  async getCourses(@Req() req: any) {
    const session = await this.sessionStore.get(req.user?.sub);
    if (!session?.kulonCookie) {
      throw new HttpException(
        { message: 'Kulon session belum ada. Silakan login ulang via SSO' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const sesskey = await this.probe.fetchSesskeyOrThrow(session.kulonCookie);
    const courses = await this.kulonService.getCourses(
      session.kulonCookie,
      sesskey,
      req.user?.sub,
      session.siapCookie,
    );
    return courses;
  }

  @Get('assignments/all')
  async getAllAssignments(@Req() req: any) {
    const session = await this.sessionStore.get(req.user?.sub);
    if (!session?.kulonCookie) {
      throw new HttpException(
        { message: 'Kulon session belum ada. Silakan login ulang via SSO' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const sesskey = await this.probe.fetchSesskeyOrThrow(session.kulonCookie);
    return this.kulonService.getAllAssignments(
      session.kulonCookie,
      sesskey,
      req.user?.sub,
    );
  }

  @Get('assignments')
  async getAssignments(@Req() req: any) {
    const session = await this.sessionStore.get(req.user?.sub);
    if (!session?.kulonCookie) {
      throw new HttpException(
        { message: 'Kulon session belum ada. Silakan login ulang via SSO' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const sesskey = await this.probe.fetchSesskeyOrThrow(session.kulonCookie);
    return this.kulonService.getAssignments(session.kulonCookie, sesskey);
  }

  @Get('assignments/:id/detail')
  async getAssignmentDetail(
    @Param('id') id: string,
    @Query('cmid') cmid: string,
    @Req() req: any,
  ) {
    const session = await this.sessionStore.get(req.user?.sub);
    if (!session?.kulonCookie) {
      throw new HttpException(
        { message: 'Kulon session belum ada. Silakan login ulang via SSO' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const assignmentId = Number(id);
    const courseModuleId = Number(cmid);
    if (
      !Number.isInteger(assignmentId) ||
      !Number.isInteger(courseModuleId) ||
      assignmentId <= 0 ||
      courseModuleId <= 0
    ) {
      throw new HttpException(
        { message: 'Detail tugas tidak ditemukan' },
        HttpStatus.NOT_FOUND,
      );
    }
    await this.probe.fetchSesskeyOrThrow(session.kulonCookie);
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
        { message: 'Kulon session belum ada. Silakan login ulang via SSO' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const courseId = Number(id);
    if (!Number.isInteger(courseId) || courseId <= 0) {
      throw new HttpException(
        { message: 'Mata kuliah tidak ditemukan' },
        HttpStatus.NOT_FOUND,
      );
    }
    const sesskey = await this.probe.fetchSesskeyOrThrow(session.kulonCookie);
    try {
      return await this.kulonService.getCourseContent(
        session.kulonCookie,
        sesskey,
        courseId,
        req.user?.sub,
      );
    } catch (e) {
      if ((e as Error).message === 'COURSE_NOT_FOUND') {
        throw new HttpException(
          { message: 'Mata kuliah tidak ditemukan' },
          HttpStatus.NOT_FOUND,
        );
      }
      throw e;
    }
  }
}
