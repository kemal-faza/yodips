import type { HandoffRaw, Service } from './contract.js';

export type HandoffDecision =
  | { action: 'ok'; token: string }
  | { action: 'needsService'; service: Service }
  | { action: 'stale' }
  | { action: 'error'; message: string; code?: string };

export function interpretHandoff(raw: HandoffRaw): HandoffDecision {
  if (!raw.ok) {
    if (raw.code === 'KULON_STALE') return { action: 'stale' };
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