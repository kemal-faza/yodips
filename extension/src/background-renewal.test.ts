import { afterEach, describe, expect, it, vi } from 'vitest';

function event() {
  const listeners = new Set<(...args: any[]) => unknown>();
  return {
    addListener: vi.fn((fn: (...args: any[]) => unknown) => listeners.add(fn)),
    removeListener: vi.fn((fn: (...args: any[]) => unknown) => listeners.delete(fn)),
    listeners,
  };
}

async function setup(options: { backend?: string; landing?: string; firstStatus?: number } = {}) {
  vi.resetModules();
  const external = event();
  const updated = event();
  const removed = event();
  const getAll = vi.fn().mockResolvedValue([
    { name: 'MoodleSession', value: 'cookie-secret', domain: 'kulon2.undip.ac.id' },
  ]);
  const create = vi.fn().mockResolvedValue({ id: 9, windowId: 7 });
  const remove = vi.fn().mockResolvedValue(undefined);
  const update = vi.fn().mockResolvedValue(undefined);
  const chrome = {
    runtime: { onMessageExternal: external, sendMessage: vi.fn() },
    storage: {
      sync: { get: vi.fn().mockResolvedValue({ serverUrl: options.backend }) },
      local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
      session: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
    },
    cookies: {
      getAllCookieStores: vi.fn().mockResolvedValue([{ id: 'regular', tabIds: [1] }, { id: 'incognito', tabIds: [2] }]),
      getAll,
      onChanged: event(),
    },
    tabs: {
      onUpdated: updated,
      onRemoved: removed,
      get: vi.fn(async (id: number) => id === 2
        ? { id: 2, windowId: 7 }
        : { id: 9, windowId: 7, status: 'complete', url: options.landing ?? 'https://kulon2.undip.ac.id/my/' }),
      create,
      remove,
      update,
    },
    alarms: { onAlarm: event() },
  };
  vi.stubGlobal('chrome', chrome);
  const fetch = vi.fn()
    .mockResolvedValueOnce({ status: options.firstStatus ?? 200, json: async () => ({ service: 'kulon', status: 'renewed' }) })
    .mockResolvedValue({ status: 200, json: async () => ({ service: 'kulon', status: 'renewed' }) });
  vi.stubGlobal('fetch', fetch);
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  await import('./background');
  const listener = [...external.listeners][0];
  const send = (url = 'https://sso.crunchy.my.id/', interactive = false) => new Promise<any>((resolve) => {
    listener({ action: 'renew', service: 'kulon', token: 'jwt-secret', interactive }, { url, tab: { id: 2, windowId: 7 } }, resolve);
  });
  return { chrome, fetch, getAll, create, remove, update, updated, removed, log, send };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('extension renewal adapter', () => {
  it('uses the requesting incognito store and keeps JWT and cookie out of its response and logs', async () => {
    const env = await setup();
    expect(await env.send()).toEqual({ status: 'recovered' });
    expect(env.getAll).toHaveBeenCalledWith({ storeId: 'incognito' });
    expect(env.fetch).toHaveBeenCalledWith(
      'https://backend.crunchy.my.id/api/auth/upstream-session/renew',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt-secret' }),
        body: JSON.stringify({ service: 'kulon', cookie: 'MoodleSession=cookie-secret' }),
        redirect: 'error',
      }),
    );
    expect(JSON.stringify(env.log.mock.calls)).not.toContain('jwt-secret');
    expect(JSON.stringify(env.log.mock.calls)).not.toContain('cookie-secret');
  });

  it('does not send credentials to a configured backend outside the allowlist', async () => {
    const env = await setup({ backend: 'https://attacker.example' });
    expect(await env.send()).toEqual({ status: 'unavailable' });
    expect(env.fetch).not.toHaveBeenCalled();
    expect(env.getAll).not.toHaveBeenCalled();
  });

  it('captures a ticket in the same window and closes its background tab', async () => {
    const env = await setup({ firstStatus: 422 });
    expect(await env.send()).toEqual({ status: 'recovered' });
    expect(env.create).toHaveBeenCalledWith(expect.objectContaining({ windowId: 7, active: false }));
    expect(env.remove).toHaveBeenCalledWith(9);
    expect(env.fetch).toHaveBeenCalledTimes(2);
  });

  it('stops and reports interaction when the ticket reaches Microsoft', async () => {
    const env = await setup({ firstStatus: 422, landing: 'https://login.microsoftonline.com/authorize' });
    expect(await env.send()).toEqual({ status: 'interaction-required' });
    expect(env.remove).toHaveBeenCalledWith(9);
    expect(env.fetch).toHaveBeenCalledTimes(1);
  });

  it('finishes on timeout and closes a tab created after the timeout', async () => {
    const env = await setup({ firstStatus: 422 });
    vi.useFakeTimers();
    let completeCreate!: (tab: { id: number; windowId: number }) => void;
    env.create.mockImplementationOnce(() => new Promise((resolve) => { completeCreate = resolve; }));
    let finished = false;
    const result = env.send().then((value) => { finished = true; return value; });
    await vi.advanceTimersByTimeAsync(0);
    expect(env.create).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(finished).toBe(true);
    expect(await result).toEqual({ status: 'unavailable' });
    completeCreate({ id: 9, windowId: 7 });
    await vi.advanceTimersByTimeAsync(0);
    expect(env.remove).toHaveBeenCalledWith(9);
  });

  it('lets the user complete Microsoft login and renews only the requested service', async () => {
    const env = await setup({ firstStatus: 422, landing: 'https://login.microsoftonline.com/authorize' });
    let finished = false;
    const result = env.send('https://sso.crunchy.my.id/', true).then((value) => { finished = true; return value; });
    await vi.waitFor(() => expect(env.create).toHaveBeenCalledWith(expect.objectContaining({ active: true })));
    expect(finished).toBe(false);
    for (const listener of env.updated.listeners) {
      listener(9, { status: 'complete' }, { id: 9, url: 'https://sso.undip.ac.id/pages/dashboard' });
    }
    await vi.waitFor(() => expect(env.update).toHaveBeenCalledWith(9, expect.objectContaining({ url: expect.stringContaining('/auth/oidc/') })));
    for (const listener of env.updated.listeners) {
      listener(9, { status: 'complete' }, { id: 9, url: 'https://kulon2.undip.ac.id/my/' });
    }
    expect(await result).toEqual({ status: 'recovered' });
    expect(env.fetch).toHaveBeenCalledTimes(2);
    expect(env.remove).toHaveBeenCalledWith(9);
  });

  it('finishes promptly when the user closes the interactive login tab', async () => {
    const env = await setup({ firstStatus: 422, landing: 'https://login.microsoftonline.com/authorize' });
    let finished = false;
    const result = env.send('https://sso.crunchy.my.id/', true).then((value) => { finished = true; return value; });
    await vi.waitFor(() => expect(env.create).toHaveBeenCalled());
    for (const listener of env.removed.listeners) listener(9, { windowId: 7, isWindowClosing: false });
    await vi.waitFor(() => expect(finished).toBe(true));
    expect(await result).toEqual({ status: 'unavailable' });
  });
});
