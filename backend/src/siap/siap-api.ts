import { Logger } from '@nestjs/common';
import { createCipheriv } from 'crypto';
import { StaleUpstreamError } from '../upstream/upstream-fetch';

const SSO_CIPHER_KEY = 'Und1pUnd1p123456';
const SSO_CIPHER_IV = 'Und1pUnd1p123456';
const CIPHER = 'aes-128-cbc';
const CIPHER_KEY_LEN = 16;

/** Replikasi CipherUtil.encrypt app resmi SIAP (AES/CBC/PKCS5 key=iv=16 byte).
 *  Output "<base64(cipher)>:<base64(iv)>". */
export function encryptNim(nim: string): string {
  let key = SSO_CIPHER_KEY;
  if (key.length < CIPHER_KEY_LEN) key = key.padEnd(CIPHER_KEY_LEN, '0');
  else if (key.length > CIPHER_KEY_LEN) key = key.slice(0, CIPHER_KEY_LEN);
  const cipher = createCipheriv(
    CIPHER,
    Buffer.from(key, 'latin1'),
    Buffer.from(SSO_CIPHER_IV, 'latin1'),
  );
  const ct = Buffer.concat([cipher.update(Buffer.from(nim, 'utf8')), cipher.final()]);
  return `${ct.toString('base64')}:${Buffer.from(SSO_CIPHER_IV, 'latin1').toString('base64')}`;
}

export interface SiapApiToken {
  token: string;
  data: Record<string, unknown>;
}

/** Transport + auth ke API resmi SIAP. Murni & mockable. */
export class SiapApiUpstream {
  private readonly logger = new Logger(SiapApiUpstream.name);
  constructor(
    private readonly apiBase: string,
    private readonly appVer: string,
  ) {}

  /** Mint access_token via POST /index.php/mahasiswa_sso (no password, no cookie). */
  async mintToken(emailSso: string, nim: string): Promise<SiapApiToken> {
    const body = new URLSearchParams({
      app_ver: this.appVer,
      mail: emailSso,
      nim: encryptNim(nim),
    });
    const res = await fetch(`${this.apiBase}/mahasiswa_sso`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    let payload: Record<string, unknown>;
    try {
      payload = (await res.json()) as Record<string, unknown>;
    } catch {
      this.logger.warn(`SIAP mintToken non-JSON (status=${res.status})`);
      throw new StaleUpstreamError('Siap', 'api-credential');
    }
    if (payload.status !== 'success') {
      this.logger.warn(`SIAP mintToken failed: ${String(payload.message ?? payload.status)}`);
      throw new StaleUpstreamError('Siap', 'api-credential');
    }
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const token = String(data.token ?? '');
    if (!token) {
      this.logger.warn('SIAP mintToken: token empty');
      throw new StaleUpstreamError('Siap', 'api-credential');
    }
    return { token, data };
  }

  /** Fetch endpoint data with Authorization: Basic base64(nim:token) + app_ver form. */
  async fetch<T>(
    endpoint: string,
    token: string,
    form: Record<string, string> = {},
    nimForAuth?: string,
  ): Promise<T> {
    const nim = nimForAuth ?? '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (nim) {
      headers.Authorization = 'Basic ' + Buffer.from(`${nim}:${token}`).toString('base64');
    }
    const body = new URLSearchParams({ app_ver: this.appVer, ...form });
    const res = await fetch(`${this.apiBase}/${endpoint}`, {
      method: 'POST',
      headers,
      body: body.toString(),
    });
    let payload: Record<string, unknown>;
    try {
      payload = (await res.json()) as Record<string, unknown>;
    } catch {
      this.logger.warn(`SIAP fetch ${endpoint} non-JSON (status=${res.status})`);
      throw new StaleUpstreamError('Siap', 'api-endpoint');
    }
    if (payload.status === 'fail' && String(payload.message).includes('update aplikasi')) {
      this.logger.warn('SIAP fetch: app version gate — update SIAP_APP_VER');
      throw new StaleUpstreamError('Siap', 'api-endpoint');
    }
    if (payload.status === 'fail' || res.status >= 400) {
      this.logger.warn(`SIAP fetch ${endpoint} failed status=${res.status} msg=${String(payload.message)}`);
      throw new StaleUpstreamError('Siap', 'api-credential');
    }
    return (payload.data ?? payload) as T;
  }
}
