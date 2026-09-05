import { RedisPairingStore } from './redis-pairing.store';

function makeClient() {
  return {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    getdel: jest.fn().mockResolvedValue(null),
    eval: jest.fn().mockResolvedValue(null),
  };
}

const RECORD = { sub: 'NIM1', sessionGeneration: 'a'.repeat(32), expiresAt: 123456 };

describe('RedisPairingStore', () => {
  it('set menyimpan JSON dengan prefix pair: + EX detik, plus tombstone pair-exp:', async () => {
    const client = makeClient();
    const s = new RedisPairingStore(client as any);
    await s.set('abc', RECORD, 300_000);
    expect(client.set).toHaveBeenCalledWith(
      'pair:abc',
      JSON.stringify(RECORD),
      'EX',
      300,
    );
    expect(client.set).toHaveBeenCalledWith('pair-exp:abc', '1', 'EX', 360);
  });

  it('get membaca JSON dan null saat miss', async () => {
    const client = makeClient();
    client.get.mockResolvedValue(JSON.stringify(RECORD));
    const s = new RedisPairingStore(client as any);
    await expect(s.get('k')).resolves.toEqual(RECORD);
    client.get.mockResolvedValue(null);
    await expect(s.get('k')).resolves.toBeNull();
  });

  it('consume memakai GETDEL (atomik) → consumed', async () => {
    const client = makeClient();
    client.getdel.mockResolvedValue(JSON.stringify(RECORD));
    const s = new RedisPairingStore(client as any);
    await expect(s.consume('k')).resolves.toEqual({ status: 'consumed', record: RECORD });
    expect(client.getdel).toHaveBeenCalledWith('pair:k');
  });

  it('consume fallback ke EVAL CAS bila GETDEL tidak didukung server', async () => {
    const client = makeClient();
    client.getdel.mockRejectedValue(new Error('unknown command'));
    client.eval.mockResolvedValue(JSON.stringify(RECORD));
    const s = new RedisPairingStore(client as any);
    await expect(s.consume('k')).resolves.toEqual({ status: 'consumed', record: RECORD });
    expect(client.eval).toHaveBeenCalled();
  });

  it('consume miss + tombstone ada → expired', async () => {
    const client = makeClient();
    client.getdel.mockResolvedValue(null);
    client.get.mockResolvedValue('1');
    const s = new RedisPairingStore(client as any);
    await expect(s.consume('k')).resolves.toEqual({ status: 'expired' });
    expect(client.get).toHaveBeenCalledWith('pair-exp:k');
  });

  it('consume miss + tanpa tombstone → invalid', async () => {
    const client = makeClient();
    client.getdel.mockResolvedValue(null);
    client.get.mockResolvedValue(null);
    const s = new RedisPairingStore(client as any);
    await expect(s.consume('k')).resolves.toEqual({ status: 'invalid' });
  });

  it('findConsumed membaca tombstone pair-used: berisi sub, null saat absen', async () => {
    const client = makeClient();
    client.getdel.mockResolvedValue(JSON.stringify(RECORD));
    const s = new RedisPairingStore(client as any);
    await s.consume('k');
    expect(client.set).toHaveBeenCalledWith(
      'pair-used:k',
      'NIM1',
      'EX',
      expect.any(Number),
    );
    client.get.mockImplementation((key: string) =>
      Promise.resolve(key === 'pair-used:k' ? 'NIM1' : null),
    );
    await expect(s.findConsumed('k')).resolves.toBe('NIM1');
    await expect(s.findConsumed('other')).resolves.toBeNull();
  });

  it('findConsumed kode tak pernah ada → null (tanpa crash)', async () => {
    const client = makeClient();
    const s = new RedisPairingStore(client as any);
    await expect(s.findConsumed('ghost')).resolves.toBeNull();
  });
});
