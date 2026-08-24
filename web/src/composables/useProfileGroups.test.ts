import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { useProfileGroups } from './useProfileGroups';
import type { SiapProfile } from '../types';

const p: SiapProfile = {
  nama: 'Budi', nim: '240601', prodi: 'Informatika', fakultas: 'FSM', angkatan: '2024',
  status: 'Aktif', // WAJIB (field wajib SiapProfile) — tanpa ini vue-tsc gagal TS2739
  nomorHp: '0812', emailSso: 'b@u.ac.id', namaIbu: 'SITI', tempatLahir: 'Semarang',
};

describe('useProfileGroups', () => {
  it('grup terbentuk berurutan & nilai kosong dibuang', () => {
    const { groups } = useProfileGroups(ref(p));
    expect(groups.value.map((g) => g.name)).toEqual(['Data Diri', 'Kependudukan', 'Kontak']);
    expect(groups.value[0].rows.map((r) => r.label)).toEqual(['NIM', 'Nama Lengkap', 'Fakultas', 'Prodi', 'Angkatan']);
  });

  it('Nama Ibu masked=true', () => {
    const { groups } = useProfileGroups(ref(p));
    const ibu = groups.value.flatMap((g) => g.rows).find((r) => r.label === 'Nama Ibu');
    expect(ibu?.masked).toBe(true);
  });

  it('profile null → groups kosong; toggleNamaIbu membalik flag', () => {
    const empty = useProfileGroups(ref(null));
    expect(empty.groups.value).toEqual([]);
    expect(empty.showNamaIbu.value).toBe(false);
    empty.toggleNamaIbu();
    expect(empty.showNamaIbu.value).toBe(true);
  });
});
