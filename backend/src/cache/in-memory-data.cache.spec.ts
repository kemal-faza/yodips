import 'reflect-metadata';
import { InMemoryDataCache } from './in-memory-data.cache';

describe('InMemoryDataCache', () => {
  it('stores and returns a JSON round-tripped value', async () => {
    const c = new InMemoryDataCache(60_000);
    await c.set('u:kulon:courses', [{ id: 1, name: 'A' }], 60_000);
    expect(await c.get<{ id: number; name: string }[]>('u:kulon:courses')).toEqual([{ id: 1, name: 'A' }]);
  });
  it('returns null when the key is absent or expired by TTL', async () => {
    const c = new InMemoryDataCache(60_000);
    expect(await c.get('missing')).toBeNull();
    await c.set('k', 'v', 1);
    await new Promise((r) => setTimeout(r, 5));
    expect(await c.get('k')).toBeNull();
  });
  it('deletes a key', async () => {
    const c = new InMemoryDataCache(60_000);
    await c.set('k', 'v');
    await c.del('k');
    expect(await c.get('k')).toBeNull();
  });
  it('stores null as a miss', async () => {
    const c = new InMemoryDataCache(60_000);
    await c.set<null>('n', null);
    expect(await c.get('n')).toBeNull();
  });
});
