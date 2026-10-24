/** Unit test murni untuk kulon-ws-shape (node test runner). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSets, extractCmidSet, mapBatchResponse, readEntryError } from './kulon-ws-shape';

test('mapBatchResponse memetakan array dengan panjang tepat sebagai positional', () => {
  const outcome = mapBatchResponse([{ index: 0 }, { index: 1 }], 2);
  assert.equal(outcome.shape, 'positional');
  if (outcome.shape !== 'positional') return;
  assert.equal(outcome.results.length, 2);
});

test('mapBatchResponse menolak array dengan panjang berbeda', () => {
  assert.equal(mapBatchResponse([{ index: 0 }], 2).shape, 'shape-unknown');
});

test('mapBatchResponse memetakan object berkunci 0..N-1 sebagai keyed', () => {
  const outcome = mapBatchResponse({ '0': { a: 1 }, '1': { a: 2 } }, 2);
  assert.equal(outcome.shape, 'keyed');
  if (outcome.shape !== 'keyed') return;
  assert.deepEqual(outcome.results, [{ a: 1 }, { a: 2 }]);
});

test('mapBatchResponse menolak object yang kehilangan satu kunci', () => {
  assert.equal(mapBatchResponse({ '0': {} }, 2).shape, 'shape-unknown');
});

test('mapBatchResponse menolak body primitif dan expectedCount tidak valid', () => {
  assert.equal(mapBatchResponse('<html>login</html>', 2).shape, 'shape-unknown');
  assert.equal(mapBatchResponse(null, 2).shape, 'shape-unknown');
  assert.equal(mapBatchResponse([], 0).shape, 'shape-unknown');
});

test('readEntryError mengambil errorcode dan pesan exception', () => {
  assert.deepEqual(
    readEntryError({ error: true, errorcode: 'accessexception', exception: { message: 'Nope' } }),
    { error: true, errorcode: 'accessexception', message: 'Nope' },
  );
});

test('readEntryError menganggap entri sukses sebagai error false', () => {
  assert.deepEqual(readEntryError({ data: { ok: true } }), { error: false, errorcode: null, message: null });
});

test('extractCmidSet assign mengumpulkan cmid unik dan terurut', () => {
  const html =
    '<a href="/mod/assign/view.php?id=42">x</a>' +
    '<a href="/mod/assign/view.php?id=7">y</a>' +
    '<a href="/mod/assign/view.php?id=42">z</a>';
  assert.deepEqual(extractCmidSet(html, 'assign'), [7, 42]);
});

test('extractCmidSet quiz mengenali href relatif maupun absolut', () => {
  const html = '<a href="view.php?id=11">a</a><a href="/mod/quiz/view.php?id=12">b</a>';
  assert.deepEqual(extractCmidSet(html, 'quiz'), [11, 12]);
});

test('extractCmidSet quiz menolak link course dan modul lain', () => {
  const html =
    '<a href="/course/view.php?id=999">c</a>' +
    '<a href="/mod/assign/view.php?id=998">a</a>' +
    '<a href="view.php?id=11">q</a>';
  assert.deepEqual(extractCmidSet(html, 'quiz'), [11]);
});

test('diffSets melaporkan selisih dua arah', () => {
  assert.deepEqual(diffSets([1, 2, 3], [2, 3, 4]), { onlyLeft: [1], onlyRight: [4] });
});
