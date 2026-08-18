import Redis from 'ioredis';

/**
 * Deteksi URL Redis ber-TLS. Heroku Redis meng-attach `rediss://` dan memakai
 * sertifikat self-signed → ioredis menolak default. Deteksi di sini biar
 * opsi TLS dipasang hanya saat perlu (koneksi lokal `redis://` tak ikut).
 */
export function isTlsUrl(url: string): boolean {
  return /^rediss:\/\//i.test(url);
}

/**
 * Bangun client ioredis dengan konfig fail-fast yang konsisten (dipakai session
 * store & data cache). Untuk `rediss://`, pasang `tls.rejectUnauthorized=false`
 * — koneksi tetap ter-enkripsi (TLS), hanya CA in-house (mis. Heroku Redis)
 * yang tidak divalidasi, sesuai pola koneksi resmi Heroku.
 */
export function buildRedisClient(url: string): Redis {
  const options: Record<string, unknown> = {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
  };
  if (isTlsUrl(url)) {
    options.tls = { rejectUnauthorized: false };
  }
  return new Redis(url, options);
}
