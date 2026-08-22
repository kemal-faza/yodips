import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationStore } from './notification-store';

class StoreMock implements Partial<NotificationStore> {
  tokens: Record<string, string[]> = {};
  subs = new Set<string>();
  async addDeviceToken(sub: string, token: string) {
    const list = this.tokens[sub] ?? (this.tokens[sub] = []);
    if (!list.includes(token)) list.push(token);
    this.subs.add(sub);
  }
  async removeDeviceToken(sub: string, token: string) {
    const rest = (this.tokens[sub] ?? []).filter((t) => t !== token);
    this.tokens[sub] = rest;
    if (rest.length === 0) this.subs.delete(sub);
  }
  async getDeviceTokens(sub: string) {
    return this.tokens[sub] ?? [];
  }
}

function makeController(opts: { nodeEnv?: string } = {}) {
  const store = new StoreMock();
  const fakePoller = {
    runCycle: async () => ({ usersChecked: 0, pushesSent: 0 }),
    calls: [] as Array<[number, number | undefined]>,
  };
  // track argumen utk verifikasi threading window
  fakePoller.runCycle = async (nowMs?: number, windowMs?: number) => {
    fakePoller.calls.push([nowMs ?? -1, windowMs]);
    return { usersChecked: 0, pushesSent: 0 };
  };
  const fakeConfig = {
    get: (k: string) => (k === 'NODE_ENV' ? opts.nodeEnv ?? 'development' : undefined),
  };
  const controller = new NotificationsController(
    store,
    fakePoller as any,
    fakeConfig as any,
  );
  return { store, fakePoller, controller };
}

describe('NotificationsController', () => {
  it('POST device menyimpan token utk req.user.sub', async () => {
    const { store, controller } = makeController();
    await controller.register({ user: { sub: 'u1' } }, { token: 'tok-1' });
    expect(await store.getDeviceTokens('u1')).toEqual(['tok-1']);
  });

  it('POST tanpa sub -> 401', async () => {
    const { controller } = makeController();
    const err = await controller.register({}, { token: 'tok' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('DELETE menghapus token; token terakhir memprune indeks', async () => {
    const { store, controller } = makeController();
    await controller.register({ user: { sub: 'u1' } }, { token: 'tok-1' });
    await controller.unregister({ user: { sub: 'u1' } }, { token: 'tok-1' });
    expect(await store.getDeviceTokens('u1')).toEqual([]);
    expect(store.subs.size).toBe(0);
  });

  it('DELETE tanpa sub -> 401', async () => {
    const { controller } = makeController();
    const err = await controller.unregister({}, { token: 'tok' }).catch((e) => e);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('devRunCycle di development menjalankan satu siklus + threading window', async () => {
    const { fakePoller, controller } = makeController();
    const sum = await controller.devRunCycle('2');
    expect(sum).toEqual({ usersChecked: 0, pushesSent: 0 });
    expect(fakePoller.calls[0][1]).toBe(2 * 3600 * 1000); // deadlineWindowMs
  });

  it('devRunCycle menolak di production', async () => {
    const { controller } = makeController({ nodeEnv: 'production' });
    const err = await controller.devRunCycle().catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
  });
});
