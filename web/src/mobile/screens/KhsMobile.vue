<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ChevronDown } from '@lucide/vue';
import { getSiapKhs } from '../../api/client';
import type { SiapKhs } from '../../types';

const khs = ref<SiapKhs | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const open = ref<Set<string>>(new Set());

onMounted(async () => {
  try {
    khs.value = await getSiapKhs();
    const first = khs.value.semesters[0]?.semester;
    if (first !== undefined) open.value = new Set([first]);
  } catch {
    error.value = 'Gagal memuat KHS.';
  } finally {
    loading.value = false;
  }
});

function toggle(sem: string): void {
  const next = new Set(open.value);
  if (next.has(sem)) next.delete(sem);
  else next.add(sem);
  open.value = next;
}
</script>

<template>
  <div class="space-y-3">
    <!-- Ringkasan IPK (footer KHS = sumber tepercaya) -->
    <section class="rounded-xl bg-primary p-5 text-primary-foreground" data-test="ipk-card">
      <p class="text-xs opacity-80">IP. Kumulatif</p>
      <p class="text-3xl font-bold leading-none" data-test="ipk-value">{{ khs?.ipk ?? '—' }}</p>
    </section>

    <div v-if="loading" class="py-10 text-center text-sm text-muted-foreground">Memuat KHS…</div>
    <div v-else-if="error" class="rounded-xl bg-danger/10 p-4 text-sm text-danger">{{ error }}</div>
    <div v-else-if="!khs || khs.semesters.length === 0" class="py-10 text-center text-sm text-muted-foreground">Belum ada data KHS.</div>

    <section
      v-for="sem in khs?.semesters ?? []"
      :key="sem.semester"
      class="overflow-hidden rounded-xl border border-border bg-card"
    >
      <button
        type="button"
        data-test="semester-toggle"
        class="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left"
        :aria-expanded="open.has(sem.semester)"
        @click="toggle(sem.semester)"
      >
        <span class="flex items-center gap-2 text-sm font-bold text-foreground">
          Semester {{ sem.semester }}
          <ChevronDown
            class="size-4 text-muted-foreground transition-transform"
            :class="open.has(sem.semester) && 'rotate-180'"
            aria-hidden="true"
          />
        </span>
        <span class="text-sm font-semibold text-primary">IP {{ sem.ip }}</span>
      </button>
      <div v-show="open.has(sem.semester)" class="border-t border-border px-4 py-3" data-test="semester-body">
        <p v-if="sem.totalSks > 0" class="text-xs text-muted-foreground">SKS {{ sem.totalSks }}</p>
        <p v-if="sem.nilai.length === 0" class="mt-2 text-sm text-muted-foreground">Belum ada nilai.</p>
        <ul v-else class="mt-1 divide-y divide-border/60">
          <li v-for="(n, i) in sem.nilai" :key="i" class="flex items-center justify-between gap-3 py-2 text-sm">
            <span class="min-w-0 flex-1 truncate font-medium text-foreground">{{ n.mataKuliah }}</span>
            <span class="shrink-0 text-xs text-muted-foreground">{{ n.nilaiHuruf }} · SKS {{ n.sks }}</span>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
