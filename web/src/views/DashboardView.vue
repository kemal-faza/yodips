<script setup lang="ts">
import { useRouter } from 'vue-router';
import SsoDashboard from '../components/SsoDashboard.vue';

const router = useRouter();
function navigate(view: 'siap' | 'kulon') {
  router.push(view === 'siap' ? '/siap' : '/kulon/dashboard');
}
</script>

<template>
  <SsoDashboard @navigate="navigate" />
</template>