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
    return (data?.events ?? [])
      .filter((e: any) => e.eventtype === 'due')
      .map((e: any) => ({
        id: e.id,
        name: e.activityname ?? e.name,
        module: e.modulename,
        eventType: e.eventtype,
        duedate: e.timestart,
        overdue: !!e.overdue,
        course: e.course?.fullname ?? '',
        courseId: e.course?.id ?? 0,
      }));
  }
}