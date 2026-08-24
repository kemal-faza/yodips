import type { SiapAbsenItem, SiapJadwal } from '../types';

/** Bentuk minimum baris mata kuliah IRS (subset bentuk inline SiapIrs). */
export interface IrsMataKuliahLike {
  kode: string;
  nama: string;
  sks: number;
  kelas?: string;
  ruang?: string;
  jadwal?: string;
  dosen?: string;
}

/**
 * Ordinal semester dari angkatan + label "2026/2027 Ganjil" — paritas
 * `semesterOrdinal` IrsScreen.kt. Input rusak → null.
 */
export function semesterOrdinal(angkatan: string, semesterBerjalan?: string | null): number | null {
  if (!angkatan || !semesterBerjalan) return null;
  const m = /(\d{4})\/\d{4}\s+(\w+)/.exec(semesterBerjalan.trim());
  if (!m) return null;
  const tahunMulai = Number(m[1]);
  const ak = Number(angkatan);
  if (!Number.isFinite(tahunMulai) || !Number.isFinite(ak) || tahunMulai < ak) return null;
  const withinYear = m[2].toLowerCase() === 'genap' ? 2 : 1;
  return (tahunMulai - ak) * 2 + withinYear;
}

/** Distinct-FIRST baris jadwal BER-TANGGAL per nama matkul (lowercase-trim). */
export function jadwalByNamaMap(jadwal: SiapJadwal[]): Map<string, SiapJadwal> {
  const out = new Map<string, SiapJadwal>();
  for (const row of jadwal ?? []) {
    if (!row.matakuliah || !row.tanggal) continue;
    const key = row.matakuliah.trim().toLowerCase();
    if (!out.has(key)) out.set(key, row);
  }
  return out;
}

/**
 * View-model jadwal satu MK IRS: ruang/waktu di-join feed jadwal by nama;
 * tidak ketemu → fallback data IRS itu sendiri — paritas `irsJadwal`.
 */
export function irsJadwal(mk: IrsMataKuliahLike, jadwalMap: Map<string, SiapJadwal>): SiapJadwal {
  const joined = jadwalMap.get(mk.nama.trim().toLowerCase());
  return {
    kode: joined?.kode ?? mk.kode,
    hari: joined?.hari ?? '',
    matakuliah: mk.nama,
    ruang: joined?.ruang ?? mk.ruang,
    waktu: joined?.waktu ?? mk.jadwal ?? '',
    sks: mk.sks,
    tanggal: joined?.tanggal,
  };
}

/** Map nama matkul (lowercase-trim) → ringkasan absen. */
export function absenByNamaMap(items: SiapAbsenItem[]): Map<string, SiapAbsenItem> {
  return new Map((items ?? []).map((a) => [a.nama.trim().toLowerCase(), a]));
}
