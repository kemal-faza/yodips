export type KeepAliveProbeKind =
  | 'no-cookie'
  | 'invalid'
  | 'transient'
  | 'rate-limited';

export type KeepAliveProbeResult =
  | { valid: true; setCookies: string[] }
  | { valid: false; kind: KeepAliveProbeKind; setCookies: string[] };

export function classifyProbeStatus(
  status: number,
): 'valid' | 'invalid' | 'transient' | 'rate-limited' {
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'transient';
  if (status >= 300) return 'invalid';
  if (status >= 200 && status < 300) return 'valid';
  return 'invalid';
}
