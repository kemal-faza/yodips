import { createCipheriv } from 'crypto';
import {
  timedFetch,
  StaleUpstreamError,
  type UpstreamAttemptResult,
  type UpstreamRouteContext,
} from '../upstream/upstream-fetch';
import {
  createNoopTelemetryRuntime,
  type TelemetryRuntime,
} from '../observability/telemetry';

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

const API_CONTEXTS: Readonly<Record<string, UpstreamRouteContext>> = {
  semester_aktif: {
    service: 'siap-api',
    operation: 'semester_aktif',
    route: 'POST /index.php/semester_aktif',
  },
  data_mahasiswa: {
    service: 'siap-api',
    operation: 'data_mahasiswa',
    route: 'POST /index.php/data_mahasiswa',
  },
  'v2/lihat_irs': {
    service: 'siap-api',
    operation: 'v2/lihat_irs',
    route: 'POST /index.php/v2/lihat_irs',
  },
  'v2/daftar_khs': {
    service: 'siap-api',
    operation: 'v2/daftar_khs',
    route: 'POST /index.php/v2/daftar_khs',
  },
  'v2/lihat_khs': {
    service: 'siap-api',
    operation: 'v2/lihat_khs',
    route: 'POST /index.php/v2/lihat_khs',
  },
  jadwal: {
    service: 'siap-api',
    operation: 'jadwal',
    route: 'POST /index.php/jadwal',
  },
  absen: {
    service: 'siap-api',
    operation: 'absen',
    route: 'POST /index.php/absen',
  },
  pengumuman: {
    service: 'siap-api',
    operation: 'pengumuman',
    route: 'POST /index.php/pengumuman',
  },
};

const MINT_TOKEN_CONTEXT: UpstreamRouteContext = {
  service: 'siap-api',
  operation: 'mintToken',
  route: 'POST /index.php/mahasiswa_sso',
};

function apiContext(endpoint: string): UpstreamRouteContext {
  const context = API_CONTEXTS[endpoint];
  if (!context) throw new TypeError('Invalid SIAP API endpoint');
  return context;
}

/** Transport + auth ke API resmi SIAP. Murni & mockable. */
export class SiapApiUpstream {
  constructor(
    private readonly apiBase: string,
    private readonly appVer: string,
    private readonly runtime: TelemetryRuntime = createNoopTelemetryRuntime(),
  ) {}

  /** Mint access_token via POST /index.php/mahasiswa_sso (no password, no cookie). */
  async mintToken(emailSso: string, nim: string): Promise<SiapApiToken> {
    const body = new URLSearchParams({
      app_ver: this.appVer,
      mail: emailSso,
      nim: encryptNim(nim),
    });
    const url = `${this.apiBase}/mahasiswa_sso`;
    return timedFetch<SiapApiToken>(
      this.runtime,
      MINT_TOKEN_CONTEXT,
      url,
      {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      },
      async (res): Promise<UpstreamAttemptResult<SiapApiToken>> => {
        let payload: Record<string, unknown>;
        try {
          const raw = await res.json();
          if (raw === null || typeof raw !== 'object') throw new Error('invalid payload');
          payload = raw as Record<string, unknown>;
        } catch {
          return {
            ok: false,
            error: new StaleUpstreamError('Siap', 'api-endpoint', undefined, res),
            outcome: 'parse_error',
            reason: 'malformed-json',
            status: res.status,
          };
        }
        if (payload.status !== 'success') {
          const message = typeof payload.message === 'string' ? payload.message : '';
          const authFailure =
            res.status === 401 ||
            res.status === 403 ||
            /credential|unauthorized|email salah/i.test(message);
          const reason = authFailure ? 'api-credential' : 'api-endpoint';
          return {
            ok: false,
            error: new StaleUpstreamError('Siap', reason, undefined, res),
            outcome: 'stale',
            reason,
            status: res.status,
          };
        }
        const data =
          payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
            ? (payload.data as Record<string, unknown>)
            : undefined;
        const token = data?.token;
        if (!data || typeof token !== 'string' || token.trim().length === 0) {
          return {
            ok: false,
            error: new StaleUpstreamError('Siap', 'api-endpoint', undefined, res),
            outcome: 'stale',
            reason: 'api-endpoint',
            status: res.status,
          };
        }
        return { ok: true, value: { token, data }, outcome: 'ok', status: res.status };
      },
    );
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
    // Live-verified (2026-08-27): the SIAP API rejects a data-access POST whose
    // body carries only app_ver — it answers 401 "Unauthorized data access".
    // The PLAIN nim must ride as a form field (`nim=<nim>`) on every fetch,
    // in addition to the Basic token. We drop it from `form` first so a
    // caller-passed nim never conflicts/duplicates.
    const { nim: _fin, ...rest } = form;
    const body = new URLSearchParams(
      nim ? { app_ver: this.appVer, nim, ...rest } : { app_ver: this.appVer, ...rest },
    );
    const context = apiContext(endpoint);
    return timedFetch<T>(
      this.runtime,
      context,
      `${this.apiBase}/${endpoint}`,
      {
        method: 'POST',
        headers,
        body: body.toString(),
      },
      async (res): Promise<UpstreamAttemptResult<T>> => {
        let payload: Record<string, unknown>;
        try {
          // SIAP sometimes sends JSON with text/html; body-first is intentional.
          const raw = await res.json();
          if (raw === null || typeof raw !== 'object') throw new Error('invalid payload');
          payload = raw as Record<string, unknown>;
        } catch {
          return {
            ok: false,
            error: new StaleUpstreamError('Siap', 'api-endpoint', undefined, res),
            outcome: 'parse_error',
            reason: 'malformed-json',
            status: res.status,
          };
        }
        // Keep the old 2xx/3xx compatibility path for payloads without a
        // failure status, while explicitly accepting successful JSON on any
        // HTTP status (SIAP occasionally returns an error status with data).
        if (payload.status === 'success' || (res.status < 400 && payload.status !== 'fail')) {
          return {
            ok: true,
            value: (payload.data ?? payload) as T,
            outcome: 'ok',
            status: res.status,
          };
        }
        // Auth-class failures (401/403, "Invalid credentials") → api-credential
        // (client should re-login). Everything else is an endpoint problem.
        const message = String(payload.message ?? '');
        const authFailure =
          res.status === 401 ||
          res.status === 403 ||
          /invalid credentials|unauthorized/i.test(message);
        const reason = authFailure ? 'api-credential' : 'api-endpoint';
        return {
          ok: false,
          error: new StaleUpstreamError('Siap', reason, undefined, res),
          outcome: 'stale',
          reason,
          status: res.status,
        };
      },
    );
  }
}
