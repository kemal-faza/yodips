import { describe, expect, it } from 'vitest';
import { absenByNamaMap, irsJadwal, jadwalByNamaMap, semesterOrdinal } from './irs-mobile';
import type { SiapJadwal } from '../types';

describe('semesterOrdinal (port Kotlin)', () => {
  it('"2024" + "2026/2027 Ganjil" → 5', () => {
    expect(semesterOrdinal('2024', '2026/2027 Ganjil')).toBe(5);
  });
  it('"2024" + "2026/2027 Genap" → 6', () => {
    expect(semesterOrdinal('2024', '2026/2027 Genap')).toBe(6);
  });
  it('input rusak → null', () => {
    expect(semesterOrdinal('', '2026/2027 Ganjil')).toBeNull();
    expect(semesterOrdinal('2024', 'format aneh')).toBeNull();
    expect(semesterOrdinal('2030', '2026/2027 Ganjil')).toBeNull(); // tahunMulai < angkatan
  });
});

const j: SiapJadwal = {
  hari: 'Senin', matakuliah: 'Pemrograman Web', waktu: '09:40 s/d 12:10',
  sks: 3, tanggal: '2026-08-24', kode: 'MIK9', ruang: 'Lab D',
};

describe('jadwalByNamaMap & irsJadwal', () => {
  it('distinct FIRST by nama lowercase, wajib ber-tanggal', () => {
    const map = jadwalByNamaMap([
      j,
      { ...j, kode: 'DUP' }, // duplikat → diabaikan (keep first)
      { hari: 'Selasa', matakuliah: 'Tanpa Tanggal', waktu: '', sks: 2 }, // dibuang
    ]);
    expect(map.size).toBe(1);
    expect(map.get('pemrograman web')?.kode).toBe('MIK9');
  });

  it('irsJadwal join by nama; fallback ke mk bila tidak ketemu', () => {
    const map = jadwalByNamaMap([j]);
    const joined = irsJadwal({ kode: 'MK-X', nama: 'Pemrograman Web ', sks: 3, jadwal: 'Senin 07:00' }, map);
    expect(joined).toMatchObject({ kode: 'MIK9', ruang: 'Lab D', waktu: '09:40 s/d 12:10' });
    const plain = irsJadwal({ kode: 'MK-Y', nama: 'Lain', sks: 2, ruang: 'R1', jadwal: 'Jumat 07:00' }, map);
    expect(plain).toMatchObject({ kode: 'MK-Y', ruang: 'R1', waktu: 'Jumat 07:00' });
  });
});

describe('absenByNamaMap', () => {
  it('key nama lowercase-trimmed', () => {
    const map = absenByNamaMap([{ idJadwal: '7', nama: ' Basis Data ', hadirPct: 90, hadir: 9, total: 10 }]);
    expect(map.get('basis data')?.total).toBe(10);
  });
});
