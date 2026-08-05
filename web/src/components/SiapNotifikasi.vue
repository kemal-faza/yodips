<script setup lang="ts">
import { Bell } from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
</script>

<template>
  <Card class="flex flex-col items-center justify-center gap-3 p-10 text-center">
    <CardContent class="flex flex-col items-center gap-3 p-0">
      <div class="flex size-14 items-center justify-center rounded-full bg-primary-50 dark:bg-primary-500/15">
        <Bell class="size-7 text-primary-500 dark:text-primary-400" aria-hidden="true" />
      </div>
      <h2 class="text-lg font-bold text-ink">Notifikasi</h2>
      <p class="max-w-sm text-sm text-ink-muted">
        Fitur notifikasi akan segera hadir. Pantau terus perkembangan aplikasi.
      </p>
      <Badge class="bg-gold/20 text-ink">Coming Soon</Badge>
    </CardContent>
  </Card>
</template>
