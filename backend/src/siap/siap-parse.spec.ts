import 'reflect-metadata';
import {
  currentSemesterCount,
  parseAbsenTable,
  parseIrsTable,
  parseKhsNilai,
  pickProfileValue,
  semesterLabel,
} from './siap-parse';

describe('pickProfileValue', () => {
  it('extracts a `<b>LABEL</b>:</div><div class="col-sm-9">VALUE</div>` row', () => {
    const html =
      '<div><b>Nama Lengkap</b>:</div><div class="col-sm-9">BUDI SANTOSO</div>';
    expect(pickProfileValue(html, 'Nama Lengkap')).toBe('BUDI SANTOSO');
    expect(pickProfileValue(html, 'NIM')).toBeUndefined();
  });
});

describe('parseKhsNilai', () => {
  it('skips the -kosong- placeholder and maps kode/nama/sks/huruf/bobot columns', () => {
    const kosong = '<table><tr><td colspan="9">-kosong-</td></tr></table>';
    expect(parseKhsNilai(kosong)).toEqual([]);

    // Real layout: NO, KODE, MATA KULIAH, …, SKS(c5), HURUF(c6), BOBOT(c7).
    const html = `
      <table>
        <tr><td>1</td><td>MIK1624105</td><td>Aljabar Linier</td><td>2</td><td>0</td><td>2</td><td>A</td><td>4</td></tr>
        <tr><th colspan="9">footer</th></tr>
      </table>`;
    const rows = parseKhsNilai(html);
    expect(rows).toEqual([
      {
        mataKuliah: 'Aljabar Linier',
        sks: 2,
        nilaiHuruf: 'A',
        bobot: 4,
      },
    ]);
  });
});

describe('parseIrsTable', () => {
  it('reads KODE (col 1) + NAMA DOSEN (col 7), collapsing <br> into pipes', () => {
    const html = `
      <table><tr>
        <td>1</td><td>MIK1624105</td><td>Aljabar</td><td>D</td>
        <td>3</td><td>E301</td><td>Disetujui</td>
        <td>Dr. X<br>Dr. Y</td>
      </tr></table>`;
    expect(parseIrsTable(html)).toEqual([
      { kode: 'MIK1624105', dosen: 'Dr. X | Dr. Y' },
    ]);
  });

  it('ignores rows whose kode is not an MIK-style code or dosen empty', () => {
    const html = `
      <table>
        <tr><td>1</td><td>XX</td><td>t</td><td>d</td><td>1</td><td>r</td><td>s</td><td>Dr. Z</td></tr>
        <tr><td>2</td><td>MIK1624503</td><td>PWL</td><td>C</td><td>3</td><td>E302</td><td>Disetujui</td><td></td></tr>
      </table>`;
    expect(parseIrsTable(html)).toEqual([]);
  });
});

describe('parseAbsenTable', () => {
  it('groups tbody rows into labelled sections; colspan rows carry label/message', () => {
    const html = `
      <table>
        <tbody>
          <tr><td colspan="7">Absensi Kuliah</td></tr>
          <tr>
            <td>1</td><td>Senin, 17 Agustus 2026<br>09:40 - 12:10</td><td>1</td>
            <td>C (17-08-2026)</td><td>Hadir</td><td>-</td><td>DOSEN</td>
          </tr>
          <tr><td colspan="7">Belum ada data</td></tr>
        </tbody>
        <tbody>
          <tr><td colspan="7">Absensi Ujian</td></tr>
          <tr><td colspan="7">Belum ada data</td></tr>
        </tbody>
      </table>`;
    const sections = parseAbsenTable(html);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ label: 'Absensi Kuliah' });
    expect(sections[0].rows).toEqual([
      {
        pertemuanKe: '1',
        tanggal: 'Senin, 17 Agustus 2026',
        waktu: '09:40 - 12:10',
        kelas: 'C (17-08-2026)',
        kehadiran: 'Hadir',
        waktuAbsen: '-',
        aktor: 'DOSEN',
      },
    ]);
    expect(sections[0].message).toBe('Belum ada data');
    expect(sections[1].label).toBe('Absensi Ujian');
    expect(sections[1].rows).toEqual([]);
  });
});

describe('semesterLabel / currentSemesterCount', () => {
  it('derives "ta/ta+1 Ganjil|Genap" from angkatan + cumulative semester', () => {
    expect(semesterLabel('2024', 1)).toBe('2024/2025 Ganjil');
    expect(semesterLabel('2024', 2)).toBe('2024/2025 Genap');
    expect(semesterLabel('2024', 3)).toBe('2025/2026 Ganjil');
  });

  it('counts completed semesters from the profile label', () => {
    // "2026/2027 Ganjil" with angkatan 2024 -> (2027-2024)*2 - 1 = 5
    expect(currentSemesterCount('2024', '2026/2027 Ganjil')).toBe(5);
  });
});
