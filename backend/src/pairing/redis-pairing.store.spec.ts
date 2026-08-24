import { RedisPairingStore } from './redis-pairing.store';

function makeClient() {
  return {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    getdel: jest.fn().mockResolvedValue(null),
    eval: jest.fn().mockResolvedValue(null),
  };
}

const RECORD = { sub: 'NIM1', expiresAt: 123456 };

describe('RedisPairingStore', () => {
  it('set menyimpan JSON dengan prefix pair: + EX detik', async () => {
    const client = makeClient();
    const s = new RedisPairingStore(client as any);
    await s.set('abc', RECORD, 300_000);
    expect(client.set).toHaveBeenCalledWith(
      'pair:abc',
      JSON.stringify(RECORD),
      'EX',
      300,
    );
  });

  it('get membaca JSON dan null saat miss', async () => {
    const client = makeClient();
    client.get.mockResolvedValue(JSON.stringify(RECORD));
    const s = new RedisPairingStore(client as any);
    await expect(s.get('k')).resolves.toEqual(RECORD);
    client.get.mockResolvedValue(null);
    await expect(s.get('k')).resolves.toBeNull();
  });

  it('consume memakai GETDEL (atomik)', async () => {
    const client = makeClient();
    client.getdel.mockResolvedValue(JSON.stringify(RECORD));
    const s = new RedisPairingStore(client as any);
    await expect(s.consume('k')).resolves.toEqual(RECORD);
    expect(client.getdel).toHaveBeenCalledWith('pair:k');
  });

  it('consume fallback ke EVAL CAS bila GETDEL tidak didukung server', async () => {
    const client = makeClient();
    client.getdel.mockRejectedValue(new Error('unknown command'));
    client.eval.mockResolvedValue(JSON.stringify(RECORD));
    const s = new RedisPairingStore(client as any);
    await expect(s.consume('k')).resolves.toEqual(RECORD);
    expect(client.eval).toHaveBeenCalled();
  });
});
