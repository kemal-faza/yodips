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

export interface SiapProfile {
  nama: string;
  nim: string;
  prodi: string;
  fakultas: string;
  angkatan: string;
  jalurMasuk?: string;
  semesterBerjalan?: string;
  status: string;
  sksTempuh?: number;
  sksLulus?: number;
  ipk?: number;
}

export interface SiapIrs {
  semester: string;
  totalSks: number;
  mataKuliah: Array<{
    kode: string;
    nama: string;
    sks: number;
    kelas?: string;
    ruang?: string;
    jadwal?: string;
    dosen?: string;
    status: string;
  }>;
}

export interface SiapKhsSemester {
  semester: string;
  ip: number;
  totalSks: number;
  nilai: Array<{ mataKuliah: string; sks: number; nilaiHuruf: string; bobot?: number }>;
}

export interface SiapKhs {
  ipk: number;
  semesters: SiapKhsSemester[];
}