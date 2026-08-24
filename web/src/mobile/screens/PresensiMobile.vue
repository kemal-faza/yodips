<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ChevronRight } from '@lucide/vue';
import { getSiapAbsen, getSiapKehadiran } from '../../api/client';
import type { SiapAbsenItem, SiapKehadiran } from '../../types';

const loading = ref(true);
const error = ref<string | null>(null);
const items = ref<SiapAbsenItem[]>([]);
const selected = ref<SiapAbsenItem | null>(null);
const detail = ref<SiapKehadiran | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);

onMounted(async () => {
  try {
    items.value = await getSiapAbsen();
  } catch (e: unknown) {
    const anyE = e as { response?: { data?: { message?: string } } };
    error.value = anyE.response?.data?.message ?? 'Gagal memuat daftar presensi.';
  } finally {
    loading.value = false;
  }
});

async function open(item: SiapAbsenItem): Promise<void> {
  selected.value = item;
  detail.value = null;
  detailError.value = null;
  detailLoading.value = true;
  try {
    detail.value = await getSiapKehadiran(item.idJadwal);
  } catch (e: unknown) {
    const anyE = e as { response?: { data?: { message?: string } } };
    detailError.value = anyE.response?.data?.message ?? 'Gagal memuat detail kehadiran.';
  } finally {
    detailLoading.value = false;
  }
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="loading" class="py-10 text-center text-sm text-muted-foreground">Memuat…</div>
    <div v-else-if="error" class="rounded-xl bg-danger/10 p-4 text-sm text-danger">{{ error }}</div>
    <div v-else-if="items.length === 0" class="py-10 text-center text-sm text-muted-foreground">Belum ada data presensi.</div>

    <template v-else>
      <!-- Pilih matkul -->
      <button
        v-for="it in items"
        :key="it.idJadwal"
        type="button"
        data-test="presensi-item"
        class="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors"
        :class="selected?.idJadwal === it.idJadwal ? 'border-primary bg-primary/10' : 'border-border bg-card active:bg-muted'"
        @click="open(it)"
      >
        <span class="min-w-0">
          <span class="block truncate text-sm font-medium text-foreground">{{ it.nama }}</span>
          <span class="text-xs text-muted-foreground">Hadir {{ it.hadir }}/{{ it.total }}</span>
        </span>
        <ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>

      <!-- Detail per pertemuan -->
      <div v-if="detailLoading" class="py-6 text-center text-sm text-muted-foreground">Memuat detail…</div>
      <div v-else-if="detailError" data-test="presensi-error" class="rounded-xl bg-danger/10 p-4 text-sm text-danger">
        {{ detailError }}
      </div>
      <section v-else-if="detail" class="space-y-3">
        <div
          v-for="sec in detail.sections"
          :key="sec.label"
          class="overflow-hidden rounded-xl border border-border bg-card"
        >
          <h3 class="border-b border-border px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {{ sec.label }}
          </h3>
          <p v-if="sec.message || sec.rows.length === 0" class="px-4 py-4 text-center text-xs text-muted-foreground">
            {{ sec.message ?? 'Belum ada data.' }}
          </p>
          <table v-else class="w-full text-left text-xs">
            <thead>
              <tr class="text-[10px] uppercase text-muted-foreground">
                <th class="px-3 py-2 font-medium">Pert.</th>
                <th class="px-3 py-2 font-medium">Tanggal</th>
                <th class="px-3 py-2 font-medium">Waktu</th>
                <th class="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border/60">
              <tr v-for="(r, i) in sec.rows" :key="i" class="text-foreground">
                <td class="px-3 py-2 font-medium">{{ r.pertemuanKe }}</td>
                <td class="px-3 py-2">{{ r.tanggal }}<span v-if="r.kelas" class="block text-[10px] text-muted-foreground">Kelas {{ r.kelas }}</span></td>
                <td class="px-3 py-2 whitespace-nowrap">{{ r.waktu }}</td>
                <td class="px-3 py-2">
                  <span
                    data-test="presence-badge"
                    class="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold"
                    :class="r.kehadiran.trim().toLowerCase() === 'hadir'
                      ? 'bg-success/15 text-success'
                      : 'bg-muted text-muted-foreground'"
                  >{{ r.kehadiran.trim() || '—' }}</span>
                  <span v-if="r.aktor && r.aktor !== '-'" class="mt-0.5 block text-[10px] text-muted-foreground">{{ r.aktor }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
