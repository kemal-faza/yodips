<script setup lang="ts">
import { Skeleton } from '@/components/ui/skeleton';

defineProps<{ name: string; prodi: string; nim: string; angkatan: string; loading: boolean }>();
</script>

<template>
  <section class="pb-2" data-test="dashboard-header">
    <template v-if="loading">
      <Skeleton class="h-8 w-64 rounded-md" />
      <Skeleton class="mt-2 h-4 w-80 rounded-md" />
    </template>
    <template v-else>
      <h1 class="text-2xl font-bold tracking-tight text-foreground md:text-3xl" data-test="greeting">
        Halo, {{ name }}!
      </h1>
      <p class="mt-1 text-sm text-muted-foreground" data-test="profile-line">
        {{ prodi }} · NIM {{ nim }} · Angkatan {{ angkatan }}
      </p>
    </template>
  </section>
</template>