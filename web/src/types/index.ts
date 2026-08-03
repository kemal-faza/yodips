export interface Assignment {
  id: number;
  name: string;
  module: string;
  eventType: string;
  duedate: number; // unix seconds
  overdue: boolean;
  course: string;
  courseId: number;
  assignmentId?: number; // Moodle assign instance id
  courseModuleId?: number; // Moodle cmid (used for detail URL)
}

export type SubmissionStatus = 'not_submitted' | 'submitted' | 'graded' | 'unknown';

export interface AssignmentFile {
  name: string;
  url: string;
}

export interface AssignmentDetail {
  assignmentId: number;
  name: string;
  descriptionHtml: string;
  files: AssignmentFile[];
  submission: {
    status: SubmissionStatus;
    submittedAt?: number;
    grade?: number | null;
    maxGrade?: number | null;
  };
  kulonUrl: string;
}

export interface Course {
  id: number;
  fullname: string;
  shortname: string;
  idnumber: string;
}

export interface User {
  sub: string;
  authenticated: boolean;
}

export interface CaptureResult {
  accessToken: string;
  capturedAt: number;
  hasSso: boolean;
  hasMicrosoft: boolean;
  hasKulon: boolean;
  reused?: boolean;
}

export type AssignmentStatus = 'overdue' | 'dueSoon' | 'onTrack';