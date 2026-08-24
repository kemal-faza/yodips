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
  submissionStatus?: SubmissionStatus; // from full-list scan (assign-index)
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
  semester?: string | null;
  /** Moodle's own timeline classification (source of truth for active/past). */
  timelineStatus?: 'inprogress' | 'past';
  /** Past-dated-section progress, 0–100 (omitted when unmeasurable). */
  progress?: number;
  /** Lecturer name from SIAP IRS, when approved and matched by code. */
  lecturer?: string;
}

export type FileType = 'pdf' | 'pptx' | 'ppt' | 'doc' | 'docx' | 'xls' | 'xlsx' | 'other';

export type ContentItemKind = 'file' | 'assign' | 'quiz' | 'url' | 'forum' | 'page' | 'other';

export interface CourseContentItem {
  kind: ContentItemKind;
  name: string;
  url: string;
  fileType?: FileType;
  cmid?: number;
  assignmentId?: number;
  duedate?: number;
}

export interface CourseSection {
  id: number;
  label: string;
  dateRange?: string;
  items: CourseContentItem[];
}

export interface KulonCourseContent {
  courseId: number;
  sections: CourseSection[];
}

export interface User {
  sub: string;
  authenticated: boolean;
  hasSso?: boolean;
  hasMicrosoft?: boolean;
  hasKulon?: boolean;
  hasSiap?: boolean;
  complete?: boolean;
}

export interface CaptureResult {
  accessToken: string;
  capturedAt: number;
  hasSso: boolean;
  hasMicrosoft: boolean;
  hasKulon: boolean;
  hasSiap?: boolean;
  reused?: boolean;
}

/** POST /api/auth/pair/request response: kode + URL QR + epoch ms kedaluwarsa. */
export interface PairRequestResult {
  code: string;
  qrUrl: string;
  expiresAt: number;
}

/** POST /api/auth/pair/consume: JWT utk sesi server yang sama. */
export interface PairConsumeResult {
  accessToken: string;
  hasKulon?: boolean;
  hasSiap?: boolean;
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
  fotoUrl?: string;
  tempatLahir?: string;
  tanggalLahir?: string;
  nik?: string;
  namaIbu?: string;
  kodeKewarganegaraan?: string;
  nomorHp?: string;
  emailSso?: string;
  emailPribadi?: string;
  alamatAsal?: string;
  alamatSekarang?: string;
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

export interface SiapJadwal {
  no?: number;
  kode?: string;
  hari: string;
  matakuliah: string;
  ruang?: string;
  waktu: string;
  sks: number;
}

export interface SiapNotification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  type: 'warning' | 'urgent' | 'success' | 'info';
}

export interface SiapNotifications {
  count: number;
  items: SiapNotification[];
}