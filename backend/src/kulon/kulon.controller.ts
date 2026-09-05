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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SessionRef, isSessionRef } from '../session/session-store';

interface AuthedRequest {
  user?: { sub?: string; sessionGeneration?: unknown; [k: string]: unknown };
}

function requireSessionRef(req: AuthedRequest): SessionRef {
  if (!isSessionRef(req.user)) {
    throw new HttpException(
      { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
      HttpStatus.UNAUTHORIZED,
    );
  }
  return { sub: req.user.sub, sessionGeneration: req.user.sessionGeneration };
}

@UseGuards(JwtAuthGuard)
@Controller('api/kulon')
export class KulonController {
  constructor(private readonly kulonService: KulonService) {}

  @Get('courses')
  async getCourses(@Req() req: AuthedRequest) {
    return this.kulonService.getCourses(requireSessionRef(req));
  }

  @Get('assignments/all')
  async getAllAssignments(@Req() req: AuthedRequest) {
    return this.kulonService.getAllAssignments(requireSessionRef(req));
  }

  @Get('assignments')
  async getAssignments(@Req() req: AuthedRequest) {
    return this.kulonService.getAssignments(requireSessionRef(req));
  }

  @Get('assignments/:id/detail')
  async getAssignmentDetail(
    @Param('id') id: string,
    @Query('cmid') cmid: string,
    @Req() req: AuthedRequest,
  ) {
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
    try {
      return await this.kulonService.getAssignmentDetail(
        requireSessionRef(req),
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
  async getCourseContent(@Param('id') id: string, @Req() req: AuthedRequest) {
    const courseId = Number(id);
    if (!Number.isInteger(courseId) || courseId <= 0) {
      throw new HttpException(
        { message: 'Mata kuliah tidak ditemukan' },
        HttpStatus.NOT_FOUND,
      );
    }
    try {
      return await this.kulonService.getCourseContent(requireSessionRef(req), courseId);
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
