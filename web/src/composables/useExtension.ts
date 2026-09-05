import { EXTENSION_ID } from '../config/extension';

export type ExtOutboundStatus =
  | { status: 'ok'; accessToken: string }
  | { status: 'started'; mode: 'auto' | 'semi'; message?: string }
  | { status: 'error'; message: string };

export type ExtPollStatus =
  | {
      status: 'ok';
      active?: boolean;
      accessToken?: string;
      phase?: 'sso' | 'kulon' | 'siap' | null;
    }
  | { status: 'error'; message: string };

const BRIDGE_SOURCE = 'undip-sso-extension';
const INVALID_RESPONSE = 'Extension mengirim respons tidak valid.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPhase(value: unknown): value is 'sso' | 'kulon' | 'siap' {
  return value === 'sso' || value === 'kulon' || value === 'siap';
}

export function isExtOutboundStatus(value: unknown): value is ExtOutboundStatus {
  if (!isRecord(value)) return false;
  if (value.status === 'ok') return isNonEmptyString(value.accessToken);
  if (value.status === 'started') {
    return (value.mode === 'auto' || value.mode === 'semi')
      && (value.message === undefined || isNonEmptyString(value.message));
  }
  return value.status === 'error' && isNonEmptyString(value.message);
}

export function isExtPollStatus(value: unknown): value is ExtPollStatus {
  if (!isRecord(value)) return false;
  if (value.status === 'error') return isNonEmptyString(value.message);
  if (value.status !== 'ok') return false;
  if (value.active !== undefined && typeof value.active !== 'boolean') return false;
  if (value.accessToken !== undefined && !isNonEmptyString(value.accessToken)) return false;
  if (value.phase !== undefined && value.phase !== null && !isPhase(value.phase)) return false;
  return typeof value.active === 'boolean' || isNonEmptyString(value.accessToken);
}

function rt(): any {
  return (globalThis as any).chrome?.runtime;
}

/** Send a message to the extension. Throws if not installed / no receiver. */
function send(msg: Record<string, unknown>): Promise<unknown> {
  const runtime = rt();
  if (!runtime?.sendMessage || !EXTENSION_ID) {
    return Promise.reject(new Error('Extension tidak tersedia'));
  }
  return new Promise((resolve, reject) => {
    runtime.sendMessage(EXTENSION_ID, msg, (resp: unknown) => {
      if (runtime.lastError) reject(new Error(runtime.lastError.message));
      else resolve(resp);
    });
  });
}

/**
 * Thin wrapper around the extension contract. Centralizes send / poll / receive
 * so neither the Pinia auth store nor LoginView reach into chrome.runtime.
 * No lifecycle hooks — safe to call from a store or any module.
 */
export function useExtension() {
  async function sendHandoff(): Promise<ExtOutboundStatus | 'not-installed'> {
    try {
      const response = await send({ action: 'handoff' });
      return isExtOutboundStatus(response)
        ? response
        : { status: 'error', message: INVALID_RESPONSE };
    } catch {
      return 'not-installed';
    }
  }

  async function readStatus(): Promise<ExtPollStatus | null> {
    try {
      const response = await send({ action: 'status' });
      return isExtPollStatus(response)
        ? response
        : { status: 'error', message: INVALID_RESPONSE };
    } catch {
      return null;
    }
  }

  async function sendDone(): Promise<void> {
    try { await send({ action: 'done' }); } catch { /* best-effort */ }
  }

  async function logout(): Promise<void> {
    try {
      await send({ action: 'logout' });
    } catch {
      // best-effort
    }
  }

  /** Subscribe to the final result posted to the window by the content bridge. */
  function onResult(cb: (p: ExtOutboundStatus) => void): () => void {
    const appOrigin = window.location.origin;
    const handler = (ev: MessageEvent) => {
      // Only trust a message that both (a) claims the ext source AND (b) comes
      // from THIS page's own origin. A malicious cross-origin iframe could
      // forge {source:'undip-sso-extension', ...}; ev.origin blocks it.
      if (ev.origin !== appOrigin) return;
      const d = isRecord(ev.data) ? ev.data : undefined;
      if (d?.source === BRIDGE_SOURCE && isExtOutboundStatus(d.payload)) cb(d.payload);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }

  return { sendHandoff, readStatus, sendDone, logout, onResult };
}
