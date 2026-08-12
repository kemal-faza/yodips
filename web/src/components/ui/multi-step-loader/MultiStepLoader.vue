<script setup lang="ts">
import { CircleCheck, LoaderCircle, Circle } from '@lucide/vue';
import { cn } from '@/lib/utils';

interface Step {
  text: string;
}
interface Props {
  steps: Step[];
  current: number;
  loading?: boolean;
  preventClose?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  loading: false,
  preventClose: true,
});
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-300"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition-opacity duration-300"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="loading && steps.length > 0"
      class="fixed inset-0 z-100 flex size-full items-center justify-center bg-background/60 backdrop-blur-2xl"
    >
      <button
        v-if="!preventClose"
        class="absolute right-4 top-4 z-101 inline-flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground"
        aria-label="Tutup"
        @click="emit('close')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>

      <div class="relative flex w-full max-w-sm flex-col px-6">
        <div
          v-for="(step, index) in steps"
          :key="index"
          class="mb-4 flex items-center gap-2 text-left transition-all duration-300 ease-in-out"
        >
          <CircleCheck
            v-if="index < current"
            class="size-6 shrink-0 text-primary"
          />
          <LoaderCircle
            v-else-if="index === current"
            class="size-6 shrink-0 animate-spin text-primary"
          />
          <Circle
            v-else
            class="size-6 shrink-0 text-black opacity-50 dark:text-white"
          />
          <span
            :class="cn('text-lg text-black dark:text-white', index > current && 'opacity-50')"
          >
            {{ step.text }}
          </span>
        </div>

        <div v-if="$slots.default" class="mt-2">
          <slot />
        </div>
      </div>
    </div>
  </Transition>
</template>