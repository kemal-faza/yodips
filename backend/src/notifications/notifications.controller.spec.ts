import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
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

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let store: StoreMock;

  beforeEach(async () => {
    store = new StoreMock();
    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationStore, useValue: store }],
    })
      .overrideGuard(JwtAuthGuard) // pola existing — lihat AGENTS.md testing quirks
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(NotificationsController);
  });

  it('POST device menyimpan token utk req.user.sub', async () => {
    await controller.register({ user: { sub: 'u1' } }, { token: 'tok-1' });
    expect(await store.getDeviceTokens('u1')).toEqual(['tok-1']);
  });

  it('POST tanpa sub -> 401', async () => {
    const err = await controller.register({}, { token: 'tok' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('DELETE menghapus token; token terakhir memprune indeks', async () => {
    await controller.register({ user: { sub: 'u1' } }, { token: 'tok-1' });
    await controller.unregister({ user: { sub: 'u1' } }, { token: 'tok-1' });
    expect(await store.getDeviceTokens('u1')).toEqual([]);
    expect(store.subs.size).toBe(0);
  });

  it('DELETE tanpa sub -> 401', async () => {
    const err = await controller.unregister({}, { token: 'tok' }).catch((e) => e);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });
});
