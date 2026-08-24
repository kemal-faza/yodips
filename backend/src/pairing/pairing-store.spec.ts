import { InMemoryPairingStore } from './pairing-store';

describe('InMemoryPairingStore', () => {
  it('set lalu get mengembalikan record', async () => {
    const s = new InMemoryPairingStore();
    await s.set('h1', { sub: 'NIM1', expiresAt: 999 }, 60_000);
    await expect(s.get('h1')).resolves.toEqual({ sub: 'NIM1', expiresAt: 999 });
  });

  it('get miss mengembalikan null', async () => {
    const s = new InMemoryPairingStore();
    await expect(s.get('nope')).resolves.toBeNull();
  });

  it('record kedaluwarsa terhapus dan get null', async () => {
    let t = 1000;
    const s = new InMemoryPairingStore(() => t);
    await s.set('h', { sub: 'A', expiresAt: 0 }, 500);
    t += 501;
    await expect(s.get('h')).resolves.toBeNull();
  });

  it('consume mengembalikan record SEKALI lalu null (single-use)', async () => {
    const s = new InMemoryPairingStore();
    await s.set('h', { sub: 'A', expiresAt: 0 }, 60_000);
    await expect(s.consume('h')).resolves.toEqual({ sub: 'A', expiresAt: 0 });
    await expect(s.consume('h')).resolves.toBeNull();
    await expect(s.get('h')).resolves.toBeNull();
  });

  it('set pada key yang sama menimpa', async () => {
    const s = new InMemoryPairingStore();
    await s.set('h', { sub: 'A', expiresAt: 0 }, 60_000);
    await s.set('h', { sub: 'B', expiresAt: 1 }, 60_000);
    await expect(s.get('h')).resolves.toEqual({ sub: 'B', expiresAt: 1 });
  });
});
