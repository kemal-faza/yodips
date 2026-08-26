import { computed, ref, type Ref } from 'vue';
import type { SiapProfile } from '../types';

export interface ProfileRow { label: string; value?: string; group: string; masked?: boolean }
export interface ProfileGroup { name: string; rows: ProfileRow[] }

/**
 * Grup biodata tampilan profile desktop (ProfileView).
 * Logika dipindah apa adanya dari ProfileView.vue — urutan grup & filter nilai
 * kosong tidak berubah (test ProfileView desktop adalah penjaga perilaku).
 */
export function useProfileGroups(profile: Ref<SiapProfile | null>) {
  const showNamaIbu = ref(false);

  const groups = computed<Array<ProfileGroup>>(() => {
    const p = profile.value;
    if (!p) return [];
    const rows: ProfileRow[] = [
      { label: 'NIM', value: p.nim, group: 'Data Diri' },
      { label: 'Nama Lengkap', value: p.nama, group: 'Data Diri' },
      { label: 'Fakultas', value: p.fakultas, group: 'Data Diri' },
      { label: 'Prodi', value: p.prodi, group: 'Data Diri' },
      { label: 'Angkatan', value: p.angkatan, group: 'Data Diri' },
      { label: 'Tempat lahir', value: p.tempatLahir, group: 'Kependudukan' },
      { label: 'Tanggal lahir', value: p.tanggalLahir, group: 'Kependudukan' },
      { label: 'NIK', value: p.nik, group: 'Kependudukan' },
      { label: 'Nama Ibu', value: p.namaIbu, group: 'Kependudukan', masked: true },
      { label: 'Kode kewarganegaraan', value: p.kodeKewarganegaraan, group: 'Kependudukan' },
      { label: 'Nomor HP', value: p.nomorHp, group: 'Kontak' },
      { label: 'Email SSO', value: p.emailSso, group: 'Kontak' },
      { label: 'Email pribadi', value: p.emailPribadi, group: 'Kontak' },
      { label: 'Alamat Asal', value: p.alamatAsal, group: 'Alamat' },
      { label: 'Alamat Sekarang', value: p.alamatSekarang, group: 'Alamat' },
    ].filter((r) => r.value != null && r.value !== '');
    const out: ProfileGroup[] = [];
    for (const r of rows) {
      let g = out.find((x) => x.name === r.group);
      if (!g) { g = { name: r.group, rows: [] }; out.push(g); }
      g.rows.push(r);
    }
    return out;
  });

  function toggleNamaIbu(): void {
    showNamaIbu.value = !showNamaIbu.value;
  }

  return { groups, showNamaIbu, toggleNamaIbu };
}
