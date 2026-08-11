<script setup lang="ts">
import { computed } from 'vue';
import { pageWindow } from '../utils/pagination';
import { Button } from '@/components/ui/button';

const props = defineProps<{ page: number; totalPages: number }>();
const emit = defineEmits<{ (e: 'change', page: number): void }>();

const pages = computed(() => pageWindow(props.page, props.totalPages));

function go(p: number) {
  if (p < 1 || p > props.totalPages || p === props.page) return;
  emit('change', p);
}
</script>

<template>
  <nav v-if="totalPages > 1" class="flex items-center gap-1" aria-label="Paginasi">
    <Button variant="ghost" size="sm" data-test="prev" :disabled="page <= 1" @click="go(page - 1)">‹</Button>
    <template v-for="(p, i) in pages" :key="i">
      <Button
        v-if="p !== '…'"
        variant="ghost"
        size="sm"
        :class="p === page ? 'bg-primary text-primary-foreground' : ''"
        :data-test="`page-${p}`"
        @click="go(p as number)"
      >{{ p }}</Button>
      <span v-else class="px-1 text-muted-foreground">…</span>
    </template>
    <Button variant="ghost" size="sm" data-test="next" :disabled="page >= totalPages" @click="go(page + 1)">›</Button>
  </nav>
</template>