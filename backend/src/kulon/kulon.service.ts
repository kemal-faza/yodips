import { Injectable } from '@nestjs/common';

export interface KulonCourse {
  id: number;
  fullname: string;
  shortname: string;
  idnumber: string;
}

export interface KulonAssignment {
  id: number;
  name: string;
  module: string;
  eventType: string;
  duedate: number;
  overdue: boolean;
  course: string;
  courseId: number;
  assignmentId: number;
  courseModuleId: number;
}

export interface KulonFile {
  name: string;
  url: string;
}

export interface KulonSubmission {
  status: 'not_submitted' | 'submitted' | 'graded' | 'unknown';
  submittedAt?: number;
  grade?: number | null;
  maxGrade?: number | null;
}

export interface KulonAssignmentDetail {
  assignmentId: number;
  name: string;
  descriptionHtml: string;
  files: KulonFile[];
  submission: KulonSubmission;
  kulonUrl: string;
}

@Injectable()
export class KulonService {
  private readonly baseUrl = 'https://kulon2.undip.ac.id';

  private async ajax(
    sessionCookie: string,
    sesskey: string,
    methodname: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const res = await fetch(
      `${this.baseUrl}/lib/ajax/service.php?sesskey=${sesskey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify([{ index: 0, methodname, args }]),
      },
    );
    if (!res.ok) throw new Error(`Kulon AJAX failed: ${res.status}`);
    const data = await res.json();
    const first = (data as any[])[0];
    if (first?.error) {
      throw new Error(
        `Kulon method ${methodname} error: ${first.exception?.message ?? 'unknown'}`,
      );
    }
    return first?.data;
  }

  parseSesskey(html: string): string {
    const match = html.match(/name="sesskey"\s+value="([^"]+)"/);
    if (!match) throw new Error('sesskey not found in Kulon page');
    return match[1];
  }

  async getCourses(
    sessionCookie: string,
    sesskey: string,
  ): Promise<KulonCourse[]> {
    const data = (await this.ajax(sessionCookie, sesskey, 'core_course_get_enrolled_courses_by_timeline_classification', {
      classification: 'all',
      limit: 0,
      offset: 0,
      sort: 'fullname',
    })) as { courses: any[] };
    return (data?.courses ?? []).map((c: any) => ({
      id: c.id,
      fullname: c.fullname,
      shortname: c.shortname,
      idnumber: c.idnumber ?? '',
    }));
  }

  async getAssignments(
    sessionCookie: string,
    sesskey: string,
  ): Promise<KulonAssignment[]> {
    const data = (await this.ajax(sessionCookie, sesskey, 'core_calendar_get_action_events_by_timesort', {
      timesortfrom: 0,
      timesortto: 0,
      limitnum: 50,
    })) as { events: any[] };
    return Promise.all(
      (data?.events ?? [])
        .filter((e: any) => e.eventtype === 'due')
        .map(async (e: any): Promise<KulonAssignment> => {
          const assignmentId = e.instance ?? 0;
          let courseModuleId = e.cmid ?? 0;
          if (!courseModuleId && e.instance && e.course?.id) {
            courseModuleId = await this.resolveCmid(
              sessionCookie,
              sesskey,
              e.instance,
              e.course.id,
            );
          }
          return {
            id: e.id,
            name: e.activityname ?? e.name,
            module: e.modulename,
            eventType: e.eventtype,
            duedate: e.timestart,
            overdue: !!e.overdue,
            course: e.course?.fullname ?? '',
            courseId: e.course?.id ?? 0,
            assignmentId,
            courseModuleId,
          };
        }),
    );
  }

  async getAssignmentDetail(
    sessionCookie: string,
    sesskey: string,
    assignmentId: number,
    cmid: number,
  ): Promise<KulonAssignmentDetail> {
    const pageUrl = `${this.baseUrl}/mod/assign/view.php?id=${cmid}`;
    const res = await fetch(pageUrl, {
      headers: { Cookie: sessionCookie },
      redirect: 'follow',
    });
    if (res.status === 404) throw new Error('ASSIGNMENT_NOT_FOUND');
    if (!res.ok) throw new Error(`Kulon assignment page failed: ${res.status}`);
    const html = await res.text();
    const sub = await this.ajax(
      sessionCookie,
      sesskey,
      'mod_assign_get_submission_status',
      { assignid: assignmentId },
    );
    return {
      assignmentId,
      name: this.extractName(html),
      descriptionHtml: this.extractDescription(html),
      files: this.extractFiles(html),
      submission: this.normalizeSubmission(sub),
      kulonUrl: pageUrl,
    };
  }

  private async resolveCmid(
    sessionCookie: string,
    sesskey: string,
    instance: number,
    courseId: number,
  ): Promise<number> {
    const data = (await this.ajax(
      sessionCookie,
      sesskey,
      'core_course_get_course_module_by_instance',
      { courseid: courseId, module: 'assign', instance },
    )) as { cmid?: number };
    return data?.cmid ?? 0;
  }

  private extractDescription(html: string): string {
    const match = html.match(/id="intro"[\s\S]*?<div class="no-overflow">([\s\S]*?)<\/div>/);
    return match ? match[1].trim() : '';
  }

  private extractName(html: string): string {
    const match = html.match(/id="page-header"[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/);
    if (!match) return '';
    return match[1].replace(/<[^>]*>/g, '').trim();
  }

  private extractFiles(html: string): KulonFile[] {
    const regex = /<a[^>]+href="([^"]*\/pluginfile\.php\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const result: KulonFile[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) !== null) {
      if (m[1].includes('/theme/')) continue;
      result.push({ name: m[2].replace(/<[^>]*>/g, '').trim(), url: m[1] });
    }
    return result;
  }

  private normalizeSubmission(data: any): KulonSubmission {
    if (
      !data ||
      !data.lastattempt?.submission ||
      data.lastattempt.submissionstatus !== 'submitted'
    ) {
      return { status: 'not_submitted', grade: null, maxGrade: null };
    }
    const base: KulonSubmission = {
      status: 'submitted',
      submittedAt: data.lastattempt.submission.timemodified ?? undefined,
      grade: null,
      maxGrade: null,
    };
    if (data.lastattempt.graded && data.feedback?.grade) {
      return {
        ...base,
        status: 'graded',
        grade: data.feedback.grade.grade != null ? Number(data.feedback.grade.grade) : null,
        maxGrade: data.feedback.grade.maxmark != null ? Number(data.feedback.grade.maxmark) : null,
      };
    }
    return base;
  }
}