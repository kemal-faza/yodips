<script setup lang="ts">
/**
 * Halaman Syarat Layanan publik — dapat diakses tanpa login.
 *
 * URL-nya berdampingan dengan Kebijakan Privasi di listing Chrome Web Store /
 * Play Store, dan ditautkan dari centang persetujuan di halaman login. Konten
 * (poin 1-8) adalah satu-satunya sumber kebenaran untuk syarat YoDips; update di
 * sini jika syarat berubah, lalu naikkan TERMS_VERSION di LoginView.vue supaya
 * pengguna diminta menyetujui ulang.
 */
import { computed } from 'vue';
import { useAuthStore } from '../stores/auth';

const CONTACT_EMAIL = 'kemalfaza26@gmail.com';
const LAST_UPDATED = '20 September 2026';

const auth = useAuthStore();
const homeTarget = computed(() => (auth.isAuthenticated ? '/' : '/login'));
const homeLabel = computed(() => (auth.isAuthenticated ? 'Kembali ke Beranda' : 'Kembali ke Login'));
</script>

<template>
  <main class="min-h-screen bg-background text-foreground">
    <div class="mx-auto max-w-3xl px-6 py-14 sm:py-20">
      <RouterLink
        :to="homeTarget"
        class="mb-8 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
      >
        <span aria-hidden="true">←</span>
        {{ homeLabel }}
      </RouterLink>

      <header class="mb-10 border-b border-border pb-8">
        <p class="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
          Syarat Layanan
        </p>
        <h1 class="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
          Syarat Layanan YoDips
        </h1>
        <p class="mt-3 text-sm text-muted-foreground">
          Terakhir diperbarui: {{ LAST_UPDATED }}.
        </p>
        <p class="mt-4 leading-relaxed text-muted-foreground">
          YoDips adalah proyek mahasiswa yang menyatukan layanan akademik Undip
          ke dalam satu dasbor. Dengan masuk atau memakai YoDips, kamu menyetujui
          syarat di bawah ini. Kalau tidak setuju, jangan gunakan layanan ini.
        </p>
      </header>

      <ol class="space-y-8">
        <!-- 1. Bukan layanan resmi -->
        <li class="rounded-xl border border-primary/30 bg-primary/5 p-6">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">1.</span>Bukan layanan resmi Undip
          </h2>
          <p class="mt-3 leading-relaxed">
            YoDips adalah proyek <strong>independen</strong> dan
            <strong>tidak berafiliasi dengan, tidak disponsori, dan tidak
            didukung oleh Universitas Diponegoro</strong>. Ini bukan layanan
            resmi kampus. Layanan SSO, Kulon, dan SIAP tetap milik Undip dan
            tunduk pada aturan mereka masing-masing.
          </p>
        </li>

        <!-- 2. Tanggung jawab pengguna -->
        <li class="rounded-xl bg-card p-6 surface-raised">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">2.</span>Tanggung jawab kamu
          </h2>
          <ul class="mt-3 list-disc space-y-2 pl-6 text-foreground/90">
            <li>
              Kamu memakai YoDips dengan <strong>akunmu sendiri</strong>. Jangan
              memakai akun orang lain, dan jangan meminta orang lain memakai akunmu.
            </li>
            <li>
              Kamu menaati aturan pemakaian sistem Undip. Kamu bertanggung jawab
              atas aktivitas yang terjadi lewat sesimu.
            </li>
            <li>
              Kamu tidak memakai layanan ini untuk mengakses data mahasiswa lain,
              mengganggu layanan Undip, atau melanggar hukum yang berlaku.
            </li>
          </ul>
        </li>

        <!-- 3. Privasi -->
        <li class="rounded-xl bg-card p-6 surface-raised">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">3.</span>Data dan privasi
          </h2>
          <p class="mt-3 leading-relaxed">
            Data apa yang diproses, untuk apa, berapa lama disimpan, dan bagaimana
            cara meminta penghapusannya dijelaskan di
            <a href="/privacy" class="font-medium text-primary underline underline-offset-4 hover:opacity-80">
              Kebijakan Privasi
            </a>, yang menjadi bagian tak terpisah dari syarat ini.
          </p>
        </li>

        <!-- 4. Tersedia apa adanya -->
        <li class="rounded-xl bg-card p-6 surface-raised">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">4.</span>Tersedia apa adanya
          </h2>
          <p class="mt-3 leading-relaxed">
            Layanan ini disediakan <strong>"apa adanya" (as is)</strong> tanpa
            jaminan apa pun, termasuk jaminan ketersediaan, ketepatan data, atau
            kesesuaian untuk tujuan tertentu. Data ditampilkan sebagai hasil
            pembacaan dari sistem Undip dan bisa tertunda, tidak lengkap, atau
            salah. <strong>Selalu jadikan SIAP dan Kulon sebagai acuan resmi</strong>
            untuk nilai, jadwal, dan status akademikmu.
          </p>
        </li>

        <!-- 5. Batasan tanggung jawab -->
        <li class="rounded-xl bg-card p-6 surface-raised">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">5.</span>Batasan tanggung jawab
          </h2>
          <p class="mt-3 leading-relaxed">
            Sejauh diizinkan hukum yang berlaku, pengelola YoDips tidak
            bertanggung jawab atas kerugian tidak langsung atau insidental yang
            timbul dari pemakaian layanan ini, termasuk kehilangan data, nilai
            yang salah dibaca, atau layanan yang tidak bisa diakses.
          </p>
        </li>

        <!-- 6. Penghentian -->
        <li class="rounded-xl bg-card p-6 surface-raised">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">6.</span>Penghentian layanan
          </h2>
          <p class="mt-3 leading-relaxed">
            Kamu bisa berhenti kapan saja: logout, dan minta penghapusan data
            lewat kontak di bawah. Pengelola bisa menghentikan atau mengubah
            layanan, atau mencabut akses bagi pemakaian yang melanggar syarat
            ini, tanpa pemberitahuan lebih dulu.
          </p>
        </li>

        <!-- 7. Perubahan syarat -->
        <li class="rounded-xl bg-card p-6 surface-raised">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">7.</span>Perubahan syarat
          </h2>
          <p class="mt-3 leading-relaxed">
            Syarat ini bisa berubah. Versi terbaru selalu berlaku, dan tanggal di
            atas menunjukkan kapan terakhir diubah. Perubahan yang bersifat
            material akan diikuti permintaan persetujuan ulang saat kamu login.
          </p>
        </li>

        <!-- 8. Hukum & kontak -->
        <li class="rounded-xl bg-card p-6 surface-raised">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">8.</span>Hukum yang berlaku &amp; kontak
          </h2>
          <p class="mt-3 leading-relaxed">
            Syarat ini tunduk pada hukum Republik Indonesia. Pertanyaan, keluhan,
            atau permintaan penghapusan data bisa dikirim ke:
          </p>
          <p class="mt-3">
            <a
              :href="`mailto:${CONTACT_EMAIL}`"
              class="font-medium text-primary underline underline-offset-4 hover:opacity-80"
            >
              {{ CONTACT_EMAIL }}
            </a>
          </p>
        </li>
      </ol>

      <footer class="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">
        <p>
          Kode sumber YoDips terbuka di
          <a
            href="https://github.com/kemal-faza/yodips"
            class="font-medium text-primary underline underline-offset-4 hover:opacity-80"
          >
            GitHub
          </a>
          dengan lisensi MIT. Lihat juga
          <a href="/privacy" class="font-medium text-primary underline underline-offset-4 hover:opacity-80">
            Kebijakan Privasi
          </a>.
        </p>
      </footer>
    </div>
  </main>
</template>
