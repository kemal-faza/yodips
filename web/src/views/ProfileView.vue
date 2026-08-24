<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getSiapProfile } from '../api/client';
import type { SiapProfile } from '../types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import PairingCard from '../components/PairingCard.vue';

const profile = ref<SiapProfile | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const showNamaIbu = ref(false);

interface Row { label: string; value?: string; group: string; masked?: boolean }

function initial(name?: string): string {
  if (!name) return '?';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

const groups = computed<Array<{ name: string; rows: Row[] }>>(() => {
  const p = profile.value;
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
    if (!g) { g = { name: r.group, rows: [] }; out.push(g); }
    g.rows.push(r);
  }
  return out;
});

onMounted(async () => {
  loading.value = true;
  error.value = null;
  try {
    profile.value = await getSiapProfile();
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? 'Gagal memuat profil.';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-if="loading" class="text-muted-foreground">Memuat profil…</div>
  <div v-else-if="error" class="rounded-2xl bg-danger/10 p-4 text-danger">{{ error }}</div>
  <div v-else-if="!profile" class="text-muted-foreground">Belum ada data profil.</div>
  <div v-else class="grid gap-6 lg:grid-cols-3">
    <aside class="space-y-4">
      <Card>
        <CardContent class="p-6 text-center">
          <Avatar class="mx-auto size-28 border-2 border-border bg-muted text-foreground">
            <AvatarImage v-if="profile?.fotoUrl" :src="profile.fotoUrl" alt="Foto" />
            <AvatarFallback class="border-2 border-current font-bold">{{ initial(profile?.nama) }}</AvatarFallback>
          </Avatar>
          <p class="mt-3 font-semibold text-foreground">{{ profile?.semesterBerjalan ?? '—' }}</p>
          <Badge class="mt-1 bg-gold/20 text-foreground">{{ profile?.status ?? '—' }}</Badge>
        </CardContent>
      </Card>
    </aside>

    <div class="lg:col-span-2">
      <Card>
        <CardContent class="p-6">
          <template v-for="g in groups" :key="g.name">
            <h3 class="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">{{ g.name }}</h3>
            <dl class="space-y-2 text-sm">
              <div v-for="r in g.rows" :key="r.label" class="flex flex-col sm:flex-row sm:gap-4 sm:py-1">
                <dt class="w-40 shrink-0 font-medium text-muted-foreground">{{ r.label }}</dt>
                <dd class="text-foreground">
                  <template v-if="r.masked">
                    <span>{{ showNamaIbu ? (r.value ?? '—') : '********' }}</span>
                    <Button variant="link" class="ml-2" @click="showNamaIbu = !showNamaIbu">
                      {{ showNamaIbu ? 'Sembunyikan' : 'Tampilkan' }}
                    </Button>
                  </template>
                  <template v-else>{{ r.value ?? '—' }}</template>
                </dd>
              </div>
            </dl>
          </template>
        </CardContent>
      </Card>
    </div>
  </div>
  <PairingCard class="mt-6" />
</template>