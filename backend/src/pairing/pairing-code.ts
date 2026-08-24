import { createHash, randomBytes } from 'node:crypto';

/** Crockford Base32: tanpa I/L/O/U agar aman dibaca/diketik manusia. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // panjang 32 → bytes[i] % 32 uniform (tanpa bias modulo)

export const PAIRING_CODE_LENGTH = 8;

export function generatePairingCode(): string {
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/** Uppercase → buang spasi/dash → petakan huruf ambigu (O→0, I/L→1). */
export function normalizePairingCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** Key store selalu hash — dump Redis tidak membocorkan kode aktif. */
export function hashPairingCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}
