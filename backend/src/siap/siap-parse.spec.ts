import 'reflect-metadata';
import {
  currentSemesterCount,
  lecturersFromIrs,
  parseAbsenTable,
  parseApiAbsen,
  parseApiDaftarKhs,
  parseApiIrs,
  parseApiJadwal,
  parseApiKhs,
  parseApiNotifications,
  parseApiProfile,
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

describe('parseApiProfile', () => {
  it('maps data_mahasiswa + semester_aktif into SiapProfile', () => {
    const data = {
      nim: '24060124120013',
      nama: 'MUHAMAD KEMAL FAZA',
      nama_ps: 'Informatika S1',
      namafak: 'SAINS DAN MATEMATIKA',
      tahun_masuk: '2024',
      tempat_lahir: 'KUALA KAPUAS',
      tanggal_lahir: '2006-05-26',
      nik: '620301 260506 0001',
      nama_ibu: 'SITI HAJJAH MARIA ULFAH',
      sso_email: 'kemalfaza26@students.undip.ac.id',
      status_terakhir: 'Aktif',
      smt_update_status: '1',
      hp: '089693048519',
      foto: 'https://x/foto.jpg',
      jalur_masuk: 'SNBP',
    };
    const sem = { nm_smt: '2026/2027 Ganjil' };
    const p = parseApiProfile(data, sem as any);
    expect(p.nim).toBe('24060124120013');
    expect(p.prodi).toBe('Informatika S1');
    expect(p.fakultas).toBe('SAINS DAN MATEMATIKA');
    expect(p.angkatan).toBe('2024');
    expect(p.emailSso).toBe('kemalfaza26@students.undip.ac.id');
    expect(p.status).toBe('Aktif');
    expect(p.semesterBerjalan).toBe('2026/2027 Ganjil');
    expect(p.nomorHp).toBe('089693048519');
  });
});

describe('parseApiJadwal', () => {
  it('maps jadwal rows into SiapJadwal[]', () => {
    const rows = [
      { hari: 'senin', nama_mk: 'Sistem Informasi', nama_ruang: 'Daring (Online) ()',
        waktu_mulai: '07:00:00', waktu_selesai: '09:30:00', sks: '3.0',
        tanggal_pertemuan: '2026-08-30' },
    ];
    const out = parseApiJadwal(rows as any);
    expect(out).toHaveLength(1);
    expect(out[0].hari).toBe('senin');
    expect(out[0].matakuliah).toBe('Sistem Informasi');
    expect(out[0].sks).toBe(3);
    expect(out[0].tanggal).toBe('2026-08-30');
  });
});

describe('parseApiKhs', () => {
  it('maps v2/lihat_khs rows into nilai + computes ip', () => {
    const rows = [
      { nama_mk: 'Pancasila', sks_mk: '2', nilai_akhir_huruf: 'A', nilai_bobot: '4' },
      { nama_mk: 'Struktur Diskret', sks_mk: '4', nilai_akhir_huruf: 'A', nilai_bobot: '4' },
    ];
    const nilai = parseApiKhs(rows as any);
    expect(nilai).toHaveLength(2);
    expect(nilai[0].mataKuliah).toBe('Pancasila');
    expect(nilai[0].sks).toBe(2);
    expect(nilai[0].nilaiHuruf).toBe('A');
    expect(nilai[0].bobot).toBe(4);
  });
});

describe('parseApiDaftarKhs', () => {
  it('extracts ipk + semester list', () => {
    const rows = [
      { ta: '2024', smt: '1', smt_ambil: '1', ipk: '3.65' },
      { ta: '2025', smt: '2', smt_ambil: '2', ipk: '3.70' },
    ];
    const out = parseApiDaftarKhs(rows as any);
    expect(out.ipk).toBe(3.65);
    expect(out.semesters).toHaveLength(2);
    expect(out.semesters[0]).toEqual({ ta: '2024', smt: '1', smtAmbil: '1' });
  });
});

describe('parseApiIrs', () => {
  it('maps v2/lihat_irs rows into mataKuliah', () => {
    const rows = [
      { kode_mk: 'MIK1624103', nama_mk: 'Struktur Diskret', sks_mk: '4',
        nama_kelas: 'D', jadwal: 'Kamis 13:00 Ruang A302', nama_dosen: 'Dosen A' },
    ];
    const mk = parseApiIrs(rows as any);
    expect(mk).toHaveLength(1);
    expect(mk[0].kode).toBe('MIK1624103');
    expect(mk[0].sks).toBe(4);
    expect(mk[0].dosen).toBe('Dosen A');
  });

  it('extracts lecturers filtered by kode pattern, joins multi-name with |', () => {
    const rows = [
      { kode_mk: 'MIK1624103', nama_dosen: 'Dosen A' },
      { kode_mk: 'MIK1624103', nama_dosen: 'Dosen B' },
      { kode_mk: 'UUW1624002', nama_dosen: '' }, // filtered: no dosen
    ];
    const out = lecturersFromIrs(rows as any);
    expect(out).toEqual([{ kode: 'MIK1624103', dosen: 'Dosen A | Dosen B' }]);
  });
});

describe('parseApiAbsen', () => {
  it('groups rows by kode_mk into SiapAbsenItem with hadir/total/hadirPct', () => {
    const rows = [
      { kode_mk: 'MIK1624503', nama_mk: 'Sistem Informasi', idjadwal: '216328', kehadiran: 'hadir' },
      { kode_mk: 'MIK1624503', nama_mk: 'Sistem Informasi', idjadwal: '216328', kehadiran: 'Hadir' },
      { kode_mk: 'MIK1624503', nama_mk: 'Sistem Informasi', idjadwal: '216328', kehadiran: 'alpa' },
      { kode_mk: 'UUW1624008', nama_mk: 'Kewirausahaan', idjadwal: '216329', kehadiran: 'hadir' },
    ];
    const out = parseApiAbsen(rows as any);
    expect(out).toHaveLength(2);
    const si = out.find((o) => o.idJadwal === '216328')!;
    expect(si.nama).toBe('Sistem Informasi');
    expect(si.hadir).toBe(2);
    expect(si.total).toBe(3);
    expect(si.hadirPct).toBe(Math.round((2 / 3) * 100));
  });
});

describe('parseApiNotifications', () => {
  it('maps pengumuman rows into SiapNotifications', () => {
    const rows = [
      { id: '1', judul: 'Pengumuman', isi: 'Isi', created_at: '2026-08-01', read: false, jenis: 'info' },
    ];
    const out = parseApiNotifications(rows as any);
    expect(out.count).toBe(1);
    expect(out.items[0].title).toBe('Pengumuman');
    expect(out.items[0].type).toBe('info');
  });
});
