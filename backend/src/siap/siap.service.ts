import { Injectable } from '@nestjs/common';

export interface SiapSessionCheck {
  valid: boolean;
  reason: 'ok' | 'no-cookie' | 'stale';
}

export interface SiapProfile {
  nama: string;
  nim: string;
  prodi: string;
  fakultas: string;
  angkatan: string;
  jalurMasuk?: string;
  semesterBerjalan?: string;
  status: string; // aktif | cuti | dll
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
    status: string; // rencana | disetujui
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

@Injectable()
export class SiapService {
  private readonly baseUrl = 'https://siap.undip.ac.id';
  // EXACT probe URL + authenticated-page fingerprint from docs/2026-08-04-siap-spike.md §2.
  private readonly probeUrl = 'https://siap.undip.ac.id/'; // TODO: fill exact from spike doc §2
  private readonly authMarker = '<AUTH_MARKER_FROM_SPIKE>'; // TODO: fill exact from spike doc §2

  async checkSessionValid(siapCookie: string): Promise<SiapSessionCheck> {
    if (!siapCookie) return { valid: false, reason: 'no-cookie' };
    let res: Response;
    try {
      res = await fetch(this.probeUrl, {
        headers: { Cookie: siapCookie },
        redirect: 'follow',
      });
    } catch {
      return { valid: false, reason: 'stale' };
    }
    if (!res.ok) return { valid: false, reason: 'stale' };
    if (/\/login\//i.test(res.url)) return { valid: false, reason: 'stale' };
    const html = await res.text();
    if (!html.includes(this.authMarker)) return { valid: false, reason: 'stale' };
    return { valid: true, reason: 'ok' };
  }

  // getProfile / getIrs / getKhs are implemented in Task 3 (transport from spike).
  // These stubs exist so the controller scaffold compiles; they throw until the
  // real scrapers land.
  async getProfile(_siapCookie: string): Promise<SiapProfile> {
    throw new Error('getProfile not implemented — see Task 3');
  }

  async getIrs(_siapCookie: string): Promise<SiapIrs> {
    throw new Error('getIrs not implemented — see Task 3');
  }

  async getKhs(_siapCookie: string): Promise<SiapKhs> {
    throw new Error('getKhs not implemented — see Task 3');
  }
}