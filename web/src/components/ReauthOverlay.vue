<script setup lang="ts">
import { useAuthStore } from '../stores/auth';
import MultiStepLoader from '@/components/ui/multi-step-loader/MultiStepLoader.vue';
import AuroraBackground from '@/components/ui/aurora-background/AuroraBackground.vue';

const auth = useAuthStore();

const phaseToStep: Record<string, number> = { sso: 0, kulon: 1, siap: 2 };

const steps = [
  { text: 'SSO' },
  { text: 'Kulon' },
  { text: 'SIAP' },
];
</script>

<template>
  <div
    v-if="auth.reauthing"
    class="fixed inset-0 z-[120]"
    data-test="reauth-overlay"
  >
    <AuroraBackground>
      <MultiStepLoader
        :loading="auth.reauthing"
        :current="phaseToStep[auth.reauthPhase ?? ''] ?? 0"
        :steps="steps"
        prevent-close
      >
        <p class="text-center text-sm text-muted-foreground">Memulihkan sesi…</p>
      </MultiStepLoader>
    </AuroraBackground>
  </div>
</template>