<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { ScheduleItem } from '../utils/dashboard';

const props = defineProps<{ items: ScheduleItem[]; semester: string | null; loading: boolean }>();

const view = ref<'grid' | 'table'>('grid');
const days = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

const gridItems = computed(() => props.items.filter((i) => i.day && i.timeStart && i.timeEnd));
</script>

<template>
  <section class="-mx-6 space-y-4 border-y border-border bg-secondary/50 px-6 py-6 md:-mx-8 md:px-8" data-test="schedule-section">
    <div v-if="loading" class="space-y-3">
      <Skeleton v-for="i in 3" :key="i" class="h-16 rounded-lg" />
    </div>
    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-bold text-foreground">Jadwal Kuliah IRS {{ semester ? `— ${semester}` : '' }}</h2>
          <p class="mt-0.5 text-xs text-muted-foreground">Jadwal perkuliahan mingguan dari SIAP Undip</p>
        </div>
        <div class="flex gap-1 text-xs">
          <Button variant="outline" size="sm" :class="view === 'grid' ? 'bg-primary/10 font-semibold text-primary' : ''" data-test="schedule-view-grid" @click="view = 'grid'">Grid</Button>
          <Button variant="outline" size="sm" :class="view === 'table' ? 'bg-primary/10 font-semibold text-primary' : ''" data-test="schedule-view-table" @click="view = 'table'">Tabel</Button>
        </div>
      </div>

      <div v-if="view === 'grid'" class="overflow-x-auto">
        <div v-if="gridItems.length === 0" class="py-10 text-center text-sm text-muted-foreground">
          Belum ada jadwal kuliah yang bisa ditampilkan sebagai grid.
        </div>
        <div v-else class="grid min-w-[700px] grid-cols-6 gap-3">
          <div v-for="day in days" :key="day" class="pt-2">
            <div class="border-b border-border/60 pb-2 text-center text-xs font-bold uppercase tracking-wider text-primary">{{ day }}</div>
            <div class="mt-3 space-y-2.5">
              <div
                v-for="it in gridItems.filter((i) => i.day === day)"
                :key="it.id"
                :data-test="`grid-course-${it.code}`"
                class="rounded-md border border-border bg-card p-3 transition-colors hover:border-primary"
              >
                <span class="text-[10px] font-semibold uppercase tracking-wider text-primary">{{ it.code }}</span>
                <h4 class="mt-1 text-xs font-medium text-foreground">{{ it.courseName }}</h4>
                <div class="mt-2 text-[10px] text-muted-foreground">{{ it.timeStart }} – {{ it.timeEnd }}</div>
                <div v-if="it.room" class="mt-1 text-[10px] text-muted-foreground/80">{{ it.room }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th class="px-4 py-3 font-medium">Hari</th>
              <th class="px-4 py-3 font-medium">Jam</th>
              <th class="px-4 py-3 font-medium">Kode</th>
              <th class="px-4 py-3 font-medium">Mata Kuliah</th>
              <th class="px-4 py-3 font-medium">Ruang</th>
              <th class="px-4 py-3 font-medium">SKS</th>
              <th class="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="it in items" :key="it.id" class="border-b border-border last:border-0 hover:bg-muted/50">
              <td class="px-4 py-3 text-xs font-semibold text-primary">{{ it.day ?? '—' }}</td>
              <td class="px-4 py-3 text-xs">{{ it.timeStart && it.timeEnd ? `${it.timeStart} – ${it.timeEnd}` : (it.jadwalRaw ?? '—') }}</td>
              <td class="px-4 py-3 text-xs text-primary">{{ it.code }}</td>
              <td class="px-4 py-3 font-medium text-foreground">{{ it.courseName }}</td>
              <td class="px-4 py-3 text-xs text-muted-foreground">{{ it.room ?? '—' }}</td>
              <td class="px-4 py-3 text-center text-xs">{{ it.sks }}</td>
              <td class="px-4 py-3 text-right text-xs capitalize text-muted-foreground">{{ it.status }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>