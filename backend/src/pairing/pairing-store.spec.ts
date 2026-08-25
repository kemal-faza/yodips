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

  it('record kedaluwarsa: get null (entri ditahan utk status consume)', async () => {
    let t = 1000;
    const s = new InMemoryPairingStore(() => t);
    await s.set('h', { sub: 'A', expiresAt: 0 }, 500);
    t += 501;
    await expect(s.get('h')).resolves.toBeNull();
    // consume tetap bisa melaporkan EXPIRED (bukan invalid)
    await expect(s.consume('h')).resolves.toEqual({ status: 'expired' });
  });

  it('consume mengembalikan consumed SEKALI lalu invalid (single-use)', async () => {
    const s = new InMemoryPairingStore();
    await s.set('h', { sub: 'A', expiresAt: 0 }, 60_000);
    await expect(s.consume('h')).resolves.toEqual({
      status: 'consumed',
      record: { sub: 'A', expiresAt: 0 },
    });
    await expect(s.consume('h')).resolves.toEqual({ status: 'invalid' });
    await expect(s.get('h')).resolves.toBeNull();
  });

  it('consume kode tak dikenal → invalid', async () => {
    const s = new InMemoryPairingStore();
    await expect(s.consume('nope')).resolves.toEqual({ status: 'invalid' });
  });

  it('set pada key yang sama menimpa', async () => {
    const s = new InMemoryPairingStore();
    await s.set('h', { sub: 'A', expiresAt: 0 }, 60_000);
    await s.set('h', { sub: 'B', expiresAt: 1 }, 60_000);
    await expect(s.get('h')).resolves.toEqual({ sub: 'B', expiresAt: 1 });
  });
});
