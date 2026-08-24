<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { LogOut, Moon, Sun } from '@lucide/vue';
import { getSiapProfile } from '../../api/client';
import type { SiapProfile } from '../../types';
import { useAuthStore } from '../../stores/auth';
import { useThemeStore } from '../../stores/theme';
import { useProfileGroups } from '../../composables/useProfileGroups';
import PairingCard from '../../components/PairingCard.vue';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const router = useRouter();
const auth = useAuthStore();
const theme = useThemeStore();

const profile = ref<SiapProfile | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const { groups, showNamaIbu, toggleNamaIbu } = useProfileGroups(profile);

const initial = computed(() => auth.user?.sub?.[0]?.toUpperCase() ?? 'U');

onMounted(async () => {
  loading.value = true;
  error.value = null;
  try {
    profile.value = await getSiapProfile();
  } catch {
    error.value = 'Gagal memuat profil.';
  } finally {
    loading.value = false;
  }
});

function logout(): void {
  // Logout PWA = LOKAL saja (spec §3): sesi server bersama tidak dihancurkan.
  auth.logout();
  router.push('/login');
}
</script>

<template>
  <div class="space-y-4">
    <!-- Identitas -->
    <section class="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
      <Avatar class="size-14 border border-border bg-muted" data-test="profile-avatar">
        <AvatarImage v-if="auth.fotoUrl" :src="auth.fotoUrl" alt="Foto profil" />
        <AvatarFallback class="font-bold text-foreground" data-test="profile-initial">{{ initial }}</AvatarFallback>
      </Avatar>
      <div class="min-w-0">
        <p class="truncate text-sm font-bold text-foreground">{{ profile?.nama ?? '—' }}</p>
        <p class="truncate text-xs text-muted-foreground">{{ profile?.prodi ?? '' }} · NIM {{ profile?.nim ?? '—' }}</p>
      </div>
    </section>

    <!-- Dark mode -->
    <section class="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
      <span class="text-sm font-medium text-foreground">Mode Gelap</span>
      <button
        type="button"
        data-test="dark-toggle"
        class="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        :aria-label="theme.dark ? 'Pindah ke tema terang' : 'Pindah ke tema gelap'"
        @click="theme.toggle()"
      >
        <Sun v-if="theme.dark" class="size-4 text-gold" aria-hidden="true" />
        <Moon v-else class="size-4" aria-hidden="true" />
        {{ theme.dark ? 'Gelap' : 'Terang' }}
      </button>
    </section>

    <!-- Status -->
    <div v-if="loading" class="text-sm text-muted-foreground">Memuat profil…</div>
    <div v-else-if="error" class="rounded-xl bg-danger/10 p-4 text-sm text-danger">{{ error }}</div>

    <!-- Grup biodata -->
    <section v-else class="rounded-xl border border-border bg-card px-4 py-2">
      <template v-for="g in groups" :key="g.name">
        <h3 class="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{{ g.name }}</h3>
        <dl class="divide-y divide-border/60 text-sm">
          <div v-for="r in g.rows" :key="r.label" class="flex items-start justify-between gap-4 py-2">
            <dt class="shrink-0 text-muted-foreground">{{ r.label }}</dt>
            <dd class="text-right text-foreground">
              <template v-if="r.masked">
                <span>{{ showNamaIbu ? (r.value ?? '—') : '********' }}</span>
                <button type="button" class="ml-2 cursor-pointer text-xs font-semibold text-primary" @click="toggleNamaIbu">
                  {{ showNamaIbu ? 'Sembunyikan' : 'Tampilkan' }}
                </button>
              </template>
              <template v-else>{{ r.value ?? '—' }}</template>
            </dd>
          </div>
        </dl>
      </template>
    </section>

    <!-- Pairing -->
    <PairingCard />

    <!-- Logout -->
    <button
      type="button"
      data-test="profile-logout"
      class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-danger/40 py-2.5 text-sm font-semibold text-danger active:bg-danger/10"
      @click="logout"
    >
      <LogOut class="size-4" aria-hidden="true" /> Keluar
    </button>
  </div>
</template>
