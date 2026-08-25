/** Mirror backend pairing-code.normalizePairingCode (jangan drift; lihat spec §4.2). */
export function normalizePairingInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

const VALID_CODE_RE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;

/** Base fallback agar relative URL hasil QR (`/login?pair=X`) tetap ter-parse. */
const PARSE_BASE = 'http://localhost';

/**
 * Terima hasil scan/deep-link: URL absolut, path relatif dgn param `pair`
 * (backend mengirim qrUrl relatif bila FRONTEND_BASE_URL kosong), atau kode polos.
 * Kembalikan kode ternormalisasi yang valid, atau null.
 */
export function extractPairCode(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let fromQuery: string | null = null;
  try {
    // Absolut dipakai apa adanya; selain itu coba sebagai relative terhadap base dummy.
    const url = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
      ? new URL(trimmed)
      : new URL(trimmed, PARSE_BASE);
    fromQuery = url.searchParams.get('pair');
  } catch {
    // bukan URL sama sekali: perlakukan sebagai kode polos di bawah
  }
  if (fromQuery) {
    const code = normalizePairingInput(fromQuery);
    return VALID_CODE_RE.test(code) ? code : null;
  }
  const code = normalizePairingInput(trimmed);
  return VALID_CODE_RE.test(code) ? code : null;
}

/** Pesan error pairing per kasus (status HTTP + kode envelope backend). */
export function pairErrorMessage(status: number | undefined, code?: string): string {
  if (status === 400 && code === 'EXPIRED_CODE') {
    return 'Kode sudah kedaluwarsa. Minta kode baru di perangkat utama.';
  }
  if (status === 400) {
    return 'Kode tidak valid atau sudah kedaluwarsa. Minta kode baru.';
  }
  if (status === 409) {
    return 'Sesi di perangkat lama sudah berakhir. Login ulang di sana, lalu minta kode baru.';
  }
  if (status === 429) {
    return 'Terlalu banyak percobaan. Tunggu sekitar 1 menit lalu coba lagi.';
  }
  return 'Gagal pairing. Periksa koneksi lalu coba lagi.';
}
