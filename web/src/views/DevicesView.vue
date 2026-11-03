<script setup lang="ts">
import PairingCard from '../components/PairingCard.vue';
</script>

<template>
  <div class="space-y-2">
    <h1 class="text-2xl font-bold">Perangkat</h1>
    <p class="text-sm text-muted-foreground">
      Tautkan HP atau browser lain ke sesi ini. Kode hanya berlaku sekali dan punya masa berlaku singkat.
    </p>
    <PairingCard class="mt-4" />
  </div>
</template>
