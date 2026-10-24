/** Unit test murni untuk kulon-ws-http dengan fetch palsu (node test runner). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ajaxBatch,
  fetchSesskey,
  launchToken,
  publicTokenShape,
  restCall,
  type FetchLike,
} from './kulon-ws-http';

interface FakeResponse {
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

function fakeFetch(
  response: FakeResponse | (Partial<FakeResponse> & { body?: string }),
): { fetchImpl: FetchLike; calls: Array<{ url: string; init?: RequestInit }> } {
  const full: FakeResponse =
    typeof (response as FakeResponse).text === 'function'
      ? (response as FakeResponse)
      : res(response as Partial<FakeResponse> & { body?: string });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return full as unknown as Response;
  }) as FetchLike;
  return { fetchImpl, calls };
}

function res(partial: Partial<FakeResponse> & { body?: string }): FakeResponse {
  const body = partial.body ?? '';
  return {
    status: partial.status ?? 200,
    url: partial.url ?? '',
    headers: { get: (name: string) => (name.toLowerCase() === 'location' ? (partial.headers ? partial.headers.get('location') : null) : null) },
    text: async () => body,
  };
}

test('fetchSesskey mengambil sesskey dari halaman /my/', async () => {
  const { fetchImpl } = fakeFetch(res({ body: '<input name="sesskey" value="AbC123">' }));
  const result = await fetchSesskey(fetchImpl, 'MoodleSession=1');
  assert.deepEqual(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.sesskey, 'AbC123');
});

test('fetchSesskey menolak halaman login tanpa sesskey', async () => {
  const { fetchImpl } = fakeFetch(res({ url: 'https://kulon2.undip.ac.id/login/index.php', body: '<form id="login"></form>' }));
  const result = await fetchSesskey(fetchImpl, 'MoodleSession=1');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'redirect-ke-login');
});

test('ajaxBatch mengirim body array dan cookie, tanpa membocorkan cookie ke hasil', async () => {
  const { fetchImpl, calls } = fakeFetch(res({ body: '[{"error":false,"data":{}}]' }));
  const result = await ajaxBatch(fetchImpl, 'MoodleSession=rahasia', 'K1', [
    { index: 0, methodname: 'core_x', args: { a: 1 } },
  ]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /lib\/ajax\/service\.php\?sesskey=K1$/);
  assert.equal(calls[0].init?.body, '[{"index":0,"methodname":"core_x","args":{"a":1}}]');
  assert.deepEqual(result.body, [{ error: false, data: {} }]);
  assert.equal(result.text.includes('rahasia'), false);
});

test('ajaxBatch berhenti pada 429', async () => {
  const { fetchImpl } = fakeFetch(res({ status: 429, body: '' }));
  await assert.rejects(
    () => ajaxBatch(fetchImpl, 'c', 'k', [{ index: 0, methodname: 'm', args: {} }]),
    /429/,
  );
});

test('ajaxBatch mengembalikan body null saat respons bukan JSON', async () => {
  const { fetchImpl } = fakeFetch(res({ body: '<html>login</html>' }));
  const result = await ajaxBatch(fetchImpl, 'c', 'k', [{ index: 0, methodname: 'm', args: {} }]);
  assert.equal(result.body, null);
});

test('restCall menyusun parameter courseids sebagai array terindeks', async () => {
  const { fetchImpl, calls } = fakeFetch(res({ body: '{"ok":true}' }));
  await restCall(fetchImpl, 'TOKEN', 'mod_assign_get_assignments', { courseids: [7, 9] });
  assert.match(calls[0].url, /wstoken=TOKEN/);
  assert.match(calls[0].url, /wsfunction=mod_assign_get_assignments/);
  assert.equal(calls[0].init?.body, 'courseids%5B0%5D=7&courseids%5B1%5D=9');
});

test('launchToken membaca Location mentah dan memisah payload dengan tiga titik dua', async () => {
  const payload = Buffer.from('siteidhash:::token-rahasia:::private-rahasia').toString('base64');
  const { fetchImpl } = fakeFetch({
    status: 302,
    headers: { get: (name: string) => (name.toLowerCase() === 'location' ? 'kulonprobe://token=' + payload : null) },
  });
  const shape = await launchToken(fetchImpl, 'cookie', 'abc', 'kulonprobe');
  assert.equal(shape.shape, 'ok');
  if (shape.shape !== 'ok') return;
  assert.equal(shape.parts, 3);
  assert.equal(shape.token, 'token-rahasia');
  assert.deepEqual(publicTokenShape(shape), { shape: 'ok', parts: 3, tokenLen: 13 });
});

test('launchToken menerima payload dua bagian', async () => {
  const payload = Buffer.from('siteidhash:::token-rahasia').toString('base64');
  const { fetchImpl } = fakeFetch({
    status: 302,
    headers: { get: (name: string) => (name.toLowerCase() === 'location' ? 'kulonprobe://token=' + payload : null) },
  });
  const shape = await launchToken(fetchImpl, 'cookie', 'abc', 'kulonprobe');
  assert.equal(shape.shape, 'ok');
  if (shape.shape !== 'ok') return;
  assert.equal(shape.parts, 2);
});

test('launchToken mencatat kegagalan saat tidak ada Location', async () => {
  const { fetchImpl } = fakeFetch(res({ status: 200, body: '<html>konfirmasi</html>' }));
  const shape = await launchToken(fetchImpl, 'cookie', 'abc', 'kulonprobe');
  assert.equal(shape.shape, 'fail');
  if (shape.shape !== 'fail') return;
  assert.equal(shape.status, 200);
  assert.equal(shape.reason, 'tanpa-location');
});

test('launchToken mencatat kegagalan saat Location bukan skema probe', async () => {
  const { fetchImpl } = fakeFetch({
    status: 302,
    headers: { get: (name: string) => (name.toLowerCase() === 'location' ? 'https://kulon2.undip.ac.id/login/index.php' : null) },
  });
  const shape = await launchToken(fetchImpl, 'cookie', 'abc', 'kulonprobe');
  assert.equal(shape.shape, 'fail');
});
