<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { useAuthStore } from './stores/auth';
import { onReauthRequested } from './lib/reauth';
import ReauthOverlay from './components/ReauthOverlay.vue';

const auth = useAuthStore();
let offReauth: (() => void) | null = null;

onMounted(() => {
  // Any auth-token 401 from the interceptor triggers silent re-auth.
  offReauth = onReauthRequested(() => {
    void auth.attemptReauth();
  });
});

onBeforeUnmount(() => {
  offReauth?.();
});
</script>

<template>
  <ReauthOverlay />
  <router-view />
</template>