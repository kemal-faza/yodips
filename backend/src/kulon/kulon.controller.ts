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

interface AuthedRequest {
  user?: { sub?: string; [k: string]: unknown };
}

@UseGuards(JwtAuthGuard)
@Controller('api/kulon')
export class KulonController {
  constructor(private readonly kulonService: KulonService) {}

  @Get('courses')
  getCourses(@Req() req: AuthedRequest) {
    return this.kulonService.getCourses(req.user?.sub);
  }

  @Get('assignments/all')
  getAllAssignments(@Req() req: AuthedRequest) {
    return this.kulonService.getAllAssignments(req.user?.sub);
  }

  @Get('assignments')
  getAssignments(@Req() req: AuthedRequest) {
    return this.kulonService.getAssignments(req.user?.sub);
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
        req.user?.sub,
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
      return await this.kulonService.getCourseContent(req.user?.sub, courseId);
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
