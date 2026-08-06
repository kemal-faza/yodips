<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getSiapProfile } from '../api/client';
import type { SiapProfile } from '../types';
import { useAuthStore } from '../stores/auth';
import ProfileBanner, { type SiapTab } from '../components/ProfileBanner.vue';
import InfoBanner from '../components/InfoBanner.vue';
import SiapDashboard from '../components/SiapDashboard.vue';
import SiapBiodata from '../components/SiapBiodata.vue';
import SiapNotifikasi from '../components/SiapNotifikasi.vue';
import { Card, CardContent } from '@/components/ui/card';

const store = useAuthStore();

const siapTab = ref<SiapTab>('dasbor');
const profile = ref<SiapProfile | null>(null);
const profileError = ref<string | null>(null);
const hasSiap = computed(() => store.hasSiap);

function extractError(e: unknown): string {
  const anyE = e as { response?: { status?: number; data?: { message?: string } }; message?: string };
  const status = anyE.response?.status;
  const serverMsg = anyE.response?.data?.message;
  if (status === 401 || status === 403) {
    return serverMsg || 'Session login kedaluwarsa — silakan login ulang.';
  }
  if (serverMsg) return serverMsg;
  return anyE.message || 'Terjadi kesalahan tidak diketahui.';
}

async function loadProfile() {
  profileError.value = null;
  try {
    profile.value = await getSiapProfile();
  } catch (e) {
    profileError.value = extractError(e);
  }
}

function changeSiapTab(tab: SiapTab) {
  siapTab.value = tab;
}

onMounted(() => {
  if (hasSiap.value) loadProfile();
});
</script>

<template>
  <div class="space-y-4">
    <template v-if="hasSiap">
      <ProfileBanner :profile="profile" :active-tab="siapTab" @change-tab="changeSiapTab" />
      <InfoBanner message="Ringkasan akademik dan biodata Anda dari SIAP Undip." />
      <div v-if="profileError" class="rounded-2xl bg-danger/10 p-4 text-danger">
        {{ profileError }}
      </div>
      <SiapDashboard v-if="siapTab === 'dasbor'" :profile="profile" :has-siap="hasSiap" />
      <SiapBiodata v-else-if="siapTab === 'biodata'" :profile="profile" />
      <SiapNotifikasi v-else />
    </template>
    <Card v-else class="text-center">
      <CardContent class="px-4 py-8">
        <p class="font-semibold text-ink">Belum ada session SIAP</p>
        <p class="mt-1 text-sm text-ink-muted">
          Silakan login ulang via SSO untuk melihat data akademik.
        </p>
      </CardContent>
    </Card>
  </div>
</template>