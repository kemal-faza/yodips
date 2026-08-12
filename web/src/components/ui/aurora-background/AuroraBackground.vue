<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '@/lib/utils';

interface AuroraBackgroundProps {
  radialGradient?: boolean;
  class?: string;
}
const props = withDefaults(defineProps<AuroraBackgroundProps>(), {
  radialGradient: true,
});

const styles = computed(() => ({
  '--aurora':
    'repeating-linear-gradient(100deg,#01637e_10%,#2a9dbd_15%,#62c4dd_20%,#a8e0ec_25%,#0e7f9e_30%)',
  '--dark-gradient':
    'repeating-linear-gradient(100deg,#000_0%,#000_7%,transparent_10%,transparent_12%,#000_16%)',
  '--white-gradient':
    'repeating-linear-gradient(100deg,#fff_0%,#fff_7%,transparent_10%,transparent_12%,#fff_16%)',
  '--blue-300': '#62c4dd',
  '--blue-400': '#2a9dbd',
  '--blue-500': '#01637e',
  '--indigo-300': '#3faccc',
  '--violet-200': '#a8e0ec',
  '--black': '#000',
  '--white': '#fff',
  '--transparent': 'transparent',
  '--animate-aurora': 'aurora 60s linear infinite',
}));
</script>

<template>
  <div
    :style="styles"
    :class="cn('relative flex h-screen flex-col items-center justify-center bg-zinc-50 text-slate-950 dark:bg-zinc-900', props.class)"
  >
    <div class="absolute inset-0 overflow-hidden">
      <div
        :class="cn(
          `after:animate-aurora pointer-events-none absolute -inset-2.5 [background-image:var(--white-gradient),var(--aurora)] bg-size-[300%,200%] bg-position-[50%_50%,50%_50%] opacity-50 blur-[10px] invert filter will-change-transform [--aurora:repeating-linear-gradient(100deg,var(--blue-500)_10%,var(--indigo-300)_15%,var(--blue-300)_20%,var(--violet-200)_25%,var(--blue-400)_30%)] [--dark-gradient:repeating-linear-gradient(100deg,var(--black)_0%,var(--black)_7%,var(--transparent)_10%,var(--transparent)_12%,var(--black)_16%)] [--white-gradient:repeating-linear-gradient(100deg,var(--white)_0%,var(--white)_7%,var(--transparent)_10%,var(--transparent)_12%,var(--white)_16%)] after:absolute after:inset-0 after:[background-image:var(--white-gradient),var(--aurora)] after:bg-size-[200%,100%] after:bg-fixed after:mix-blend-difference after:content-[''] dark:[background-image:var(--dark-gradient),var(--aurora)] dark:invert-0 after:dark:[background-image:var(--dark-gradient),var(--aurora)]`,
          props.radialGradient && 'mask-[radial-gradient(ellipse_at_100%_0%,black_10%,var(--transparent)_70%)]',
        )"
      />
    </div>
    <div class="relative z-10 flex size-full flex-col items-center justify-center">
      <slot />
    </div>
  </div>
</template>