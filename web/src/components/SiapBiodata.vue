<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SiapProfile } from '../types';
import InfoBanner from './InfoBanner.vue';

const props = defineProps<{ profile: SiapProfile | null }>();
const showNamaIbu = ref(false);

interface Row {
  label: string;
  value?: string;
  group: string;
  masked?: boolean;
}

function initial(name?: string): string {
  if (!name) return '?';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

const groups = computed<Array<{ name: string; rows: Row[] }>>(() => {
  const p = props.profile;
  if (!p) return [];
  const rows: Row[] = [
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
  const out: Array<{ name: string; rows: Row[] }> = [];
  for (const r of rows) {
    let g = out.find((x) => x.name === r.group);
    if (!g) {
      g = { name: r.group, rows: [] };
      out.push(g);
    }
    g.rows.push(r);
  }
  return out;
});
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-3">
    <aside class="space-y-4">
      <div class="rounded-2xl border border-navy/10 bg-white p-6 text-center">
        <img
          v-if="profile?.fotoUrl"
          :src="profile.fotoUrl"
          alt="Foto"
          class="mx-auto h-28 w-28 rounded-full object-cover"
        />
        <div
          v-else
          class="mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-primary-50 text-3xl font-bold text-primary-600"
        >
          {{ initial(profile?.nama) }}
        </div>
        <p class="mt-3 font-semibold text-navy">{{ profile?.semesterBerjalan ?? '—' }}</p>
        <span
          class="mt-1 inline-block rounded-full bg-gold/20 px-3 py-0.5 text-xs font-semibold text-navy"
        >
          {{ profile?.status ?? '—' }}
        </span>
      </div>
      <button
        disabled
        class="w-full cursor-not-allowed rounded-xl border border-navy/10 bg-white px-4 py-2.5 text-sm font-medium text-navy-light"
      >
        Perbarui Biodata
      </button>
      <InfoBanner message="Pastikan data diri Anda di atas benar sebelum mendaftar WISUDA." />
    </aside>

    <div class="lg:col-span-2">
      <div class="rounded-2xl border border-navy/10 bg-white p-6">
        <template v-for="g in groups" :key="g.name">
          <h3 class="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-navy-light first:mt-0">
            {{ g.name }}
          </h3>
          <dl class="space-y-2 text-sm">
            <div v-for="r in g.rows" :key="r.label" class="flex flex-col sm:flex-row sm:gap-4 sm:py-1">
              <dt class="w-40 shrink-0 font-medium text-navy-light">{{ r.label }}</dt>
              <dd class="text-navy">
                <template v-if="r.masked">
                  <span>{{ showNamaIbu ? (r.value ?? '—') : '********' }}</span>
                  <button
                    class="ml-2 text-xs font-medium text-primary-600 hover:underline"
                    @click="showNamaIbu = !showNamaIbu"
                  >
                    {{ showNamaIbu ? 'Sembunyikan' : 'Tampilkan' }}
                  </button>
                </template>
                <template v-else>{{ r.value ?? '—' }}</template>
              </dd>
            </div>
          </dl>
        </template>
        <InfoBanner
          class="mt-6"
          title="Perhatian"
          message="Pastikan data diri Anda tercatat benar di PDDIKTI melalui forlap.ristekdikti.go.id."
        />
      </div>
    </div>
  </div>
</template>
