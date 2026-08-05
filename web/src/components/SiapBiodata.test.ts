import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import SiapBiodata from './SiapBiodata.vue';

const profile = {
  nama: 'ANONIM UJI',
  nim: '24060121130000',
  prodi: 'Informatika S1',
  fakultas: 'SAINS DAN MATEMATIKA',
  angkatan: '2024',
  status: 'AKTIF',
  semesterBerjalan: '2026/2027 Ganjil',
  tempatLahir: 'KOTA UJI',
  tanggalLahir: '01 Januari 2000',
  nik: '000000 000000 0000',
  namaIbu: 'IBU UJI',
  kodeKewarganegaraan: 'ID',
  nomorHp: '080000000000',
  emailSso: 'anonim.sso@students.undip.ac.id',
  emailPribadi: 'anonim.pribadi@contoh.test',
  alamatAsal: 'Jalan Uji, Kota Uji, Kalimantan Tengah 00000',
  alamatSekarang: 'Jl. Uji Dalam III No.8, Kota Uji 00000',
};

describe('SiapBiodata', () => {
  it('renders the biodata fields', () => {
    const w = mount(SiapBiodata, { props: { profile } });
    expect(w.text()).toContain('24060121130000');
    expect(w.text()).toContain('KOTA UJI');
    expect(w.text()).toContain('000000 000000 0000');
    expect(w.text()).toContain('anonim.sso@students.undip.ac.id');
    expect(w.text()).toContain('Jalan Uji');
    expect(w.text()).toContain('Uji');
  });

  it('masks Nama Ibu until revealed', async () => {
    const w = mount(SiapBiodata, { props: { profile } });
    expect(w.text()).toContain('********');
    expect(w.text()).not.toContain('IBU UJI');
    await w.findAll('button').find((b) => b.text().includes('Tampilkan'))!.trigger('click');
    expect(w.text()).toContain('IBU UJI');
  });

  it('renders a placeholder state when profile is null', () => {
    const w = mount(SiapBiodata, { props: { profile: null } });
    expect(w.text()).toContain('—');
  });
});