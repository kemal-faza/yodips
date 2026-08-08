import { EXTENSION_ID } from '../config/extension';

export type ExtOutboundStatus =
  | { status: 'ok'; accessToken: string }
  | { status: 'started'; mode: 'auto' | 'semi'; message?: string }
  | { status: 'error'; message: string };

export type ExtPollStatus = { status: 'ok'; active: boolean; phase?: string | null };

const BRIDGE_SOURCE = 'undip-sso-extension';

function rt(): any {
  return (globalThis as any).chrome?.runtime;
}

/** Send a message to the extension. Throws if not installed / no receiver. */
function send(msg: Record<string, unknown>): Promise<any> {
  const runtime = rt();
  if (!runtime?.sendMessage || !EXTENSION_ID) {
    return Promise.reject(new Error('Extension tidak tersedia'));
  }
  return new Promise((resolve, reject) => {
    runtime.sendMessage(EXTENSION_ID, msg, (resp: any) => {
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
      return (await send({ action: 'handoff' })) as ExtOutboundStatus;
    } catch {
      return 'not-installed';
    }
  }

  async function readStatus(): Promise<ExtPollStatus | null> {
    try {
      return (await send({ action: 'status' })) as ExtPollStatus;
    } catch {
      return null;
    }
  }

  async function sendDone(): Promise<void> {
    try { await send({ action: 'done' }); } catch { /* best-effort */ }
  }

  function logout(): Promise<void> {
    return send({ action: 'logout' }).catch(() => {});
  }

  /** Subscribe to the final result posted to the window by the content bridge. */
  function onResult(cb: (p: ExtOutboundStatus) => void): () => void {
    const handler = (ev: MessageEvent) => {
      const d = ev.data as { source?: string; payload?: ExtOutboundStatus } | undefined;
      if (d?.source === BRIDGE_SOURCE && d.payload) cb(d.payload);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }

  return { sendHandoff, readStatus, sendDone, logout, onResult };
}