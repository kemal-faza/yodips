<script setup lang="ts">
/**
 * Halaman Kebijakan Privasi publik — dapat diakses tanpa login.
 *
 * URL-nya dipakai pada kolom "Privacy policy" di listing Chrome Web Store /
 * Play Store. Konten (poin 1-6) adalah satu-satunya sumber kebenaran untuk
 * kebijakan privasi YoDips; update di sini jika kebijakan berubah.
 */
import { computed } from 'vue';
import { useAuthStore } from '../stores/auth';

// Email kontak untuk pertanyaan/hak penghapusan data.
// GANTI dengan email publik penayang sebelum dipakai di listing store.
const CONTACT_EMAIL = 'privasi@yodips.id';
const LAST_UPDATED = '20 Agustus 2026';

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
          Kebijakan Privasi
        </p>
        <h1 class="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
          Kebijakan Privasi YoDips
        </h1>
        <p class="mt-3 text-sm text-muted-foreground">
          Terakhir diperbarui: {{ LAST_UPDATED }}.
        </p>
        <p class="mt-4 leading-relaxed text-muted-foreground">
          YoDips adalah dasbor untuk mahasiswa Universitas Diponegoro (Undip)
          yang menampilkan akademik (Kulon/Moodle) dan kemahasiswaan (SIAP)
          dalam satu tempat. Kebijakan ini menjelaskan data apa saja yang
          kami sentuh, untuk apa, dan bagaimana data tersebut diperlakukan.
        </p>
      </header>

      <ol class="space-y-8">
        <!-- 1. Data yang dikumpulkan -->
        <li class="rounded-xl border border-border bg-card p-6">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">1.</span>Data yang dikumpulkan
          </h2>
          <p class="mt-3 leading-relaxed">
            Kami hanya memproses data yang dibutuhkan agar dasbor berfungsi:
          </p>
          <ul class="mt-3 list-disc space-y-2 pl-6 text-foreground/90">
            <li>
              <strong>Cookie sesi Undip</strong> (SSO, Kulon/Moodle, SIAP).
              Cookie ini <em>tidak pernah disimpan secara permanen</em> — hanya
              dipakai sementara untuk mengautentikasi sesi dan mengambil data
              akademik yang tampil di dasbor.
            </li>
            <li>
              <strong>Identitas turunan (NIM)</strong>. NIM diturunkan dari sesi
              Undip dan dipakai sebagai subjek (sub) JWT Anda. Kelengkapan
              kursus/penilaian ditampilkan dari layanan akademik atas sesi Anda.
            </li>
            <li>
              Data akademik yang Anda lihat (kursus, jadwal, tugas, IRS, KHS)
              diambil langsung dari akun Kulon/SIAP milik Anda dan hanya
              ditampilkan kembali untuk Anda.
            </li>
          </ul>
        </li>
        <!-- 2. Tujuan -->
        <li class="rounded-xl border border-border bg-card p-6">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">2.</span>Tujuan penggunaan
          </h2>
          <p class="mt-3 leading-relaxed">
            Data di atas kami gunakan <strong>semata untuk autentikasi ke dasbor
            YoDips</strong> dan menampilkan data akademik Anda. Kami tidak
            menggunakan data untuk iklan, profiling, atau tujuan lain di luar
            menyediakan layanan yang Anda minta.
          </p>
        </li>

        <!-- 3. Kemana data dikirim -->
        <li class="rounded-xl border border-border bg-card p-6">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">3.</span>Kemana data dikirim
          </h2>
          <p class="mt-3 leading-relaxed">
            Data dikirim ke <strong>backend YoDips</strong> melalui koneksi
            <strong>HTTPS</strong> yang terenkripsi. Kami
            <strong>tidak menjual, menyewakan, atau membagikan</strong> data
            Anda kepada pihak ketiga mana pun untuk kepentingan komersial.
          </p>
        </li>

        <!-- 4. Kredensial tidak disimpan -->
        <li class="rounded-xl border border-border bg-card p-6">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">4.</span>Kredensial tidak disimpan
            backend
          </h2>
          <p class="mt-3 leading-relaxed">
            Login dilakukan tanpa kredensial: Anda masuk sendiri di browser, dan
            <strong>backend tidak pernah melihat atau menyimpan kata
            sandi</strong>. Sesi disimpan:
          </p>
          <ul class="mt-3 list-disc space-y-2 pl-6 text-foreground/90">
            <li>
              <strong>InMemory (pengembangan)</strong> — sesi hilang saat
              backend dimulai ulang, sehingga Anda perlu login ulang.
            </li>
            <li>
              <strong>Redis (produksi)</strong> — disimpan terenkripsi
              (AES-256-GCM) dengan <strong>masa aktif geser (sliding TTL)
              selama 7 hari</strong>.
            </li>
          </ul>
        </li>

        <!-- 5. Kontak -->
        <li class="rounded-xl border border-border bg-card p-6">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">5.</span>Kontak &amp; hak Anda
          </h2>
          <p class="mt-3 leading-relaxed">
            Untuk pertanyaan tentang data Anda, atau untuk meminta
            <strong>penghapusan data</strong>, hubungi kami di:
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

        <!-- 6. Least privilege -->
        <li class="rounded-xl border border-primary/30 bg-primary/5 p-6">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">6.</span>Hanya data yang benar-benar
            diperlukan (least privilege)
          </h2>
          <p class="mt-3 leading-relaxed">
            Kami menganut prinsip <strong>"Only purposeful data"</strong>:
            hanya data yang dibutuhkan untuk satu fungsi — autentikasi dan
            menampilkan data akademik Anda — yang kami proses, seefisien dan
            sesedikit mungkin, dan hanya selama dibutuhkan.
          </p>
        </li>
      </ol>

      <footer class="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">
        <p>
          YoDips — dasbor akademik &amp; kemahasiswaan untuk mahasiswa Undip.
          Email hubungi data: {{ CONTACT_EMAIL }}.
        </p>
      </footer>
    </div>
  </main>
</template>