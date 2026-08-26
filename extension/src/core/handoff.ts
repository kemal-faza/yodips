import type { HandoffRaw, Service } from './contract.js';
import { BACKEND_CODES } from './contract.js';

export type HandoffDecision =
  | { action: 'ok'; token: string }
  | { action: 'needsService'; service: Service }
  | { action: 'stale'; service: Service }
  | { action: 'error'; message: string; code?: string };

export function interpretHandoff(raw: HandoffRaw): HandoffDecision {
  if (!raw.ok) {
    if (raw.code === BACKEND_CODES.KULON_STALE) return { action: 'stale', service: 'kulon' };
    return { action: 'error', message: raw.message ?? `Handoff gagal (${raw.status})`, code: raw.code };
  }
  if (raw.hasSso && raw.hasKulon && raw.hasSiap) {
    return { action: 'ok', token: raw.accessToken ?? '' };
  }
  const missing: Service = !raw.hasSso ? 'sso' : !raw.hasKulon ? 'kulon' : 'siap';
  return { action: 'needsService', service: missing };
}

export function summarizeHandoff(raw: HandoffRaw) {
  return { ok: raw.ok, code: raw.code, hasSso: raw.hasSso, hasKulon: raw.hasKulon, hasSiap: raw.hasSiap };
}

/**
 * Pesan ramah untuk kegagalan jaringan fetch (TypeError "Failed to fetch"):
 * sebut host tujuan + arahan ke Server URL popup — jangan pernah tampilkan
 * teks mentah browser ke pengguna.
 */
export function networkFailureMessage(url: string): string {
  let host = 'server';
  try {
    host = new URL(url).host;
  } catch {
    /* URL tidak valid — pakai fallback */
  }
  return `Tidak dapat terhubung ke ${host}. Periksa koneksi internet, atau set Server URL yang benar di popup extension YoDips.`;
}