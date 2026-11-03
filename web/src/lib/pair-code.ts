const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Normalisasi kode pairing. Selaras dengan `sanitizeTyped` di
 * `LoginScreen.wasmJs.kt`; lebih ketat daripada `normalizePairingCode`
 * backend (yang tidak memfilter alfabet dan tidak memotong ke 8).
 */
export function normalizePairCode(raw: string): string {
  return (raw ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .split('')
    .filter((ch) => ALPHABET.includes(ch))
    .join('')
    .slice(0, 8);
}

/** Terima kode mentah atau URL yang mengandung `pair=`; null bila tidak valid. */
export function extractPairCode(input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/[?&]pair=([^&#\s]+)/i);
  const looksLikeUrl = /^https?:\/\//i.test(raw) || raw.includes('?');
  if (!match && looksLikeUrl) return null;
  const code = normalizePairCode(match ? decodeURIComponent(match[1]) : raw);
  return code.length === 8 ? code : null;
}

/** Pesan siap tampil untuk kegagalan `POST /api/auth/pair/consume`. */
export function pairErrorMessage(err: unknown): string {
  const response = (err as { response?: { status?: number; data?: { code?: string } } })?.response;
  const status = response?.status;
  const code = response?.data?.code;
  if (status === 429) return 'Terlalu banyak percobaan. Tunggu ±1 menit.';
  if (code === 'EXPIRED_CODE') return 'Kode sudah kedaluwarsa. Minta kode baru.';
  if (status === 409) {
    return 'Sesi di perangkat sumber sudah berakhir. Login ulang di sana lalu minta kode baru.';
  }
  if (code === 'INVALID_CODE' || status === 400) {
    return 'Kode tidak valid atau sudah dipakai. Minta kode baru.';
  }
  return 'Tidak bisa menghubungi server. Coba lagi.';
}
