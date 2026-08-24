/** Mirror backend pairing-code.normalizePairingCode (jangan drift; lihat spec §4.2). */
export function normalizePairingInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

const VALID_CODE_RE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;

/**
 * Terima hasil scan/deep-link: URL penuh dgn param `pair`, atau kode polos.
 * Kembalikan kode ternormalisasi yang valid, atau null.
 */
export function extractPairCode(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const fromQuery = url.searchParams.get('pair');
    if (fromQuery) {
      const code = normalizePairingInput(fromQuery);
      return VALID_CODE_RE.test(code) ? code : null;
    }
  } catch {
    // bukan URL absolut: perlakukan sebagai kode polos
  }
  const code = normalizePairingInput(trimmed);
  return VALID_CODE_RE.test(code) ? code : null;
}
