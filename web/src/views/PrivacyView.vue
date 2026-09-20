<script setup lang="ts">
/**
 * Halaman Kebijakan Privasi publik — dapat diakses tanpa login.
 *
 * URL-nya dipakai pada kolom "Privacy policy" di listing Chrome Web Store /
 * Play Store. Konten (poin 1-7) adalah satu-satunya sumber kebenaran untuk
 * kebijakan privasi YoDips; update di sini jika kebijakan berubah. Kalau isinya
 * berubah secara material, naikkan juga TERMS_VERSION di LoginView.vue supaya
 * pengguna diminta menyetujui ulang.
 *
 * Menegakkan permintaan penghapusan: lihat "Data deletion request" di
 * tools/deploy/README.md (kunci Redis apa saja yang harus dihapus).
 */
import { computed } from 'vue';
import { useAuthStore } from '../stores/auth';

// Email kontak untuk pertanyaan/hak penghapusan data.
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
          Kebijakan Privasi
        </p>
        <h1 class="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
          Kebijakan Privasi YoDips
        </h1>
        <p class="mt-3 text-sm text-muted-foreground">
          Terakhir diperbarui: {{ LAST_UPDATED }}.
        </p>
        <p class="mt-4 leading-relaxed text-muted-foreground">
          YoDips adalah dasbor untuk mahasiswa Universitas Diponegoro (Undip).
          Di sini ada akademik (Kulon/Moodle) dan kemahasiswaan (SIAP) dalam
          satu tempat. Kebijakan ini menjelaskan data apa yang kami pegang,
          untuk apa, berapa lama, dan bagaimana kami memperlakukannya.
        </p>
      </header>

      <ol class="space-y-8">
        <!-- 1. Data yang dikumpulkan -->
        <li class="rounded-xl bg-card p-6 surface-raised">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">1.</span>Data yang dikumpulkan
          </h2>
          <p class="mt-3 leading-relaxed">
            Kami hanya memproses data yang dibutuhkan agar dasbor berfungsi:
          </p>
          <ul class="mt-3 list-disc space-y-2 pl-6 text-foreground/90">
            <li>
              <strong>Cookie sesi Undip</strong> (SSO, Kulon/Moodle, SIAP).
              Cookie ini <em>tidak pernah disimpan dalam bentuk terbaca</em>:
              di server disimpan terenkripsi (AES-256-GCM) dan dipakai ulang
              untuk mengambil data akademikmu. Cookie ini tidak pernah menjadi
              isi token yang dikirim ke browser.
            </li>
            <li>
              <strong>Identitas turunan (NIM)</strong>. NIM kami turunkan dari
              sesi Undip dan jadikan subjek (sub) JWT Anda. Kursus dan penilaian
              diambil langsung dari layanan akademik atas sesi Anda.
            </li>
            <li>
              Data akademik yang Anda lihat (kursus, jadwal, tugas, IRS, KHS,
              kehadiran, notifikasi) diambil langsung dari akun Kulon/SIAP milik
              Anda dan hanya ditampilkan kembali untuk Anda.
            </li>
            <li>
              <strong>Profil</strong> dari SIAP, termasuk data kependudukan
              (tempat/tanggal lahir, NIK, nama ibu) dan kontak (nomor HP, alamat).
              Data ini hanya dipakai untuk menampilkan halaman Profil; NIK
              ditampilkan apa adanya dan nama ibu disamarkan sampai kamu menekan
              "Tampilkan".
            </li>
            <li>
              <strong>Token notifikasi</strong> (FCM untuk Android, Web Push untuk
              browser) bila kamu mengaktifkan notifikasi.
            </li>
          </ul>
        </li>
        <!-- 2. Tujuan -->
        <li class="rounded-xl bg-card p-6 surface-raised">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">2.</span>Tujuan penggunaan
          </h2>
          <p class="mt-3 leading-relaxed">
            Data di atas kami gunakan <strong>semata untuk autentikasi ke dasbor
            YoDips</strong> dan menampilkan data akademik Anda. Kami tidak
            memakai data untuk iklan, profiling, atau tujuan lain di luar
            layanan yang memang Anda minta. Tidak ada analitik pihak ketiga, dan
            data Anda tidak pernah dijual.
          </p>
        </li>

        <!-- 3. Kemana data dikirim -->
        <li class="rounded-xl bg-card p-6 surface-raised">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">3.</span>Kemana data dikirim
          </h2>
          <p class="mt-3 leading-relaxed">
            Semua data dikirim ke <strong>backend YoDips</strong> lewat koneksi
            <strong>HTTPS</strong> yang terenkripsi. Kami
            <strong>tidak menjual atau menyewakan</strong> data Anda, dan tidak
            membagikannya untuk kepentingan komersial.
          </p>
          <p class="mt-3 leading-relaxed">
            Ada satu pengecualian yang perlu kamu tahu: kalau kamu
            <strong>mengaktifkan notifikasi</strong>, ringkasan peristiwa
            akademik (nama tugas, nama mata kuliah, jadwal berubah, dan deadline)
            dikirim melalui layanan push pihak ketiga — <strong>Google Firebase
            Cloud Messaging</strong> untuk aplikasi Android, atau layanan push
            bawaan browser (mis. Mozilla atau Google) untuk PWA. Isi notifikasi
            melewati layanan tersebut agar bisa sampai ke perangkatmu. Kalau kamu
            tidak ingin ini terjadi, jangan aktifkan notifikasi; sisa fitur
            dasbor tetap berjalan normal tanpa notifikasi.
          </p>
        </li>

        <!-- 4. Berapa lama disimpan -->
        <li class="rounded-xl bg-card p-6 surface-raised">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">4.</span>Berapa lama data disimpan
          </h2>
          <p class="mt-3 leading-relaxed">
            Tidak ada data yang disimpan selamanya, kecuali kamu memintanya
            dihapus lebih awal:
          </p>
          <ul class="mt-3 list-disc space-y-2 pl-6 text-foreground/90">
            <li>
              <strong>Cookie sesi</strong>: paling lama <strong>7 hari</strong>
              sejak login terakhir (masa aktif geser), lalu otomatis hilang dari
              Redis.
            </li>
            <li>
              <strong>Cache data akademik &amp; profil</strong> (termasuk NIK dan
              alamat): hanya sebagai cache percepatan, dengan masa simpan
              menit sampai jam (KHS paling lama 30 menit, sebagian data
              dosen sampai 24 jam). Setelah itu diambil ulang dari SIAP atau
              hilang dari Redis.
            </li>
            <li>
              <strong>Snapshot notifikasi</strong> (untuk mendeteksi tugas baru
              dan jadwal berubah): <strong>14 hari</strong>.
            </li>
            <li>
              <strong>Token perangkat notifikasi</strong>: sampai kamu logout,
              menonaktifkan notifikasi, atau meminta penghapusan.
            </li>
          </ul>
        </li>

        <!-- 5. Kredensial tidak disimpan -->
        <li class="rounded-xl bg-card p-6 surface-raised">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">5.</span>Kredensial tidak disimpan
            backend
          </h2>
          <p class="mt-3 leading-relaxed">
            Anda login tanpa kredensial, cukup masuk sendiri di browser, dan
            <strong>backend tidak pernah melihat atau menyimpan kata
            sandi</strong>. Tidak ada endpoint login kata sandi: backend hanya
            menerima cookie sesi yang sudah terbentuk di browser kamu sendiri.
            Sesi disimpan:
          </p>
          <ul class="mt-3 list-disc space-y-2 pl-6 text-foreground/90">
            <li>
              <strong>InMemory (pengembangan)</strong>. Sesi hilang saat
              backend dimulai ulang, jadi Anda perlu login ulang.
            </li>
            <li>
              <strong>Redis (produksi)</strong>. Sesi disimpan terenkripsi
              (AES-256-GCM) dengan <strong>masa aktif geser (sliding TTL)
              selama 7 hari</strong>.
            </li>
          </ul>
        </li>

        <!-- 6. Kontak -->
        <li class="rounded-xl bg-card p-6 surface-raised">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">6.</span>Kontak &amp; hak Anda
          </h2>
          <p class="mt-3 leading-relaxed">
            Kamu berhak tahu data apa yang kami pegang, meminta salinannya, dan
            meminta <strong>penghapusan data</strong>. Kirim permintaanmu ke:
          </p>
          <p class="mt-3">
            <a
              :href="`mailto:${CONTACT_EMAIL}`"
              class="font-medium text-primary underline underline-offset-4 hover:opacity-80"
            >
              {{ CONTACT_EMAIL }}
            </a>
          </p>
          <p class="mt-3 leading-relaxed">
            Permintaan penghapusan akan menghapus sesi tersimpan (cookie),
            seluruh cache data akademik dan profil, snapshot notifikasi, serta
            token perangkat Anda. Permintaan diproses secara manual, jadi
            sertakan NIM yang kamu pakai agar kami tidak salah menghapus.
          </p>
        </li>

        <!-- 7. Least privilege -->
        <li class="rounded-xl border border-primary/30 bg-primary/5 p-6">
          <h2 class="font-heading text-lg font-bold">
            <span class="mr-2 text-primary">7.</span>Hanya data yang benar-benar
            diperlukan (least privilege)
          </h2>
          <p class="mt-3 leading-relaxed">
            Kami hanya memproses data yang benar-benar dibutuhkan
            <strong>("Only purposeful data")</strong>, dalam arti data yang
            dipakai untuk satu fungsi, yaitu autentikasi dan menampilkan data
            akademik Anda. Kami memprosesnya seefisien dan sesedikit mungkin,
            dan hanya selama masih dibutuhkan.
          </p>
        </li>
      </ol>

      <footer class="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">
        <p>
          YoDips — dasbor akademik &amp; kemahasiswaan untuk mahasiswa Undip.
          Email hubungi data: {{ CONTACT_EMAIL }}.
        </p>
        <p class="mt-2">
          Aturan pemakaian layanan ada di
          <a href="/terms" class="font-medium text-primary underline underline-offset-4 hover:opacity-80">
            Syarat Layanan
          </a>.
        </p>
      </footer>
    </div>
  </main>
</template>
