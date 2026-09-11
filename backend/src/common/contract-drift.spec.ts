import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ERROR_CODES } from './error-codes';

/**
 * Cross-client contract guard (see docs/adr/0002-contract-as-shared-data.md).
 *
 * The canonical contract is `contract/backend-contract.json`. Each client
 * mirrors a SUBSET of the backend error codes with its own typed constants.
 * This spec fails when:
 *  - a client invents a code that is not in the canonical list (silent drift), or
 *  - the backend's typed table drifts from the canonical JSON, or
 *  - a required core code disappears from the canonical list.
 *
 * It is intentionally one spec in the backend so all three clients are guarded
 * without adding a cross-project build step.
 */
const repoRoot = resolve(__dirname, '../../..');

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), 'utf8');
}

function canonical(): { errorCodes: string[] } {
  return JSON.parse(read('contract/backend-contract.json')) as { errorCodes: string[] };
}

/** Extract the code string literals declared in a `{ CODE: 'CODE' }` block. */
function declaredBlock(source: string, startMarker: string): string[] {
  const start = source.indexOf(startMarker);
  if (start === -1) return [];
  const rest = source.slice(start);
  const end = rest.indexOf('} as const');
  const block = end === -1 ? rest : rest.slice(0, end);
  return [...block.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1]);
}

/** Extract `const val NAME = "CODE"` declarations from a Kotlin object block. */
function declaredKotlin(source: string, startMarker: string): string[] {
  const start = source.indexOf(startMarker);
  if (start === -1) return [];
  const rest = source.slice(start);
  const end = rest.indexOf('\n}');
  const block = end === -1 ? rest : rest.slice(0, end);
  return [...block.matchAll(/const val [A-Z0-9_]+ = "([A-Z][A-Z0-9_]+)"/g)].map((m) => m[1]);
}

const CORE_CODES = ['KULON_STALE', 'SIAP_STALE', 'INVALID_TOKEN', 'SESSION_DEAD'];

const CLIENTS: { name: string; file: string; codes: () => string[] }[] = [
  {
    name: 'web',
    file: 'web/src/api/contract.ts',
    codes: () => declaredBlock(read('web/src/api/contract.ts'), 'BACKEND_ERROR_CODES = {'),
  },
  {
    name: 'extension',
    file: 'extension/src/core/contract.ts',
    codes: () => declaredBlock(read('extension/src/core/contract.ts'), 'BACKEND_CODES = {'),
  },
  {
    name: 'mobile',
    file: 'mobile/app/src/commonMain/kotlin/core/network/Contract.kt',
    codes: () =>
      declaredKotlin(
        read('mobile/app/src/commonMain/kotlin/core/network/Contract.kt'),
        'object BackendCodes {',
      ),
  },
];

describe('backend contract is the single source', () => {
  it('every required core code is canonical', () => {
    const { errorCodes } = canonical();
    for (const code of CORE_CODES) expect(errorCodes).toContain(code);
  });

  it('the typed ERROR_CODES table equals the canonical JSON list', () => {
    const canonicalSet = new Set(canonical().errorCodes);
    const typedSet = new Set(Object.values(ERROR_CODES));
    expect([...typedSet].sort()).toEqual([...canonicalSet].sort());
  });

  it.each(CLIENTS)('$name declares only canonical codes', ({ name, codes, file }) => {
    const canonicalSet = new Set(canonical().errorCodes);
    const declared = codes();
    if (declared.length === 0) {
      throw new Error(`${name} declares no codes (parsed ${file})`);
    }
    for (const code of declared) {
      if (!canonicalSet.has(code)) {
        throw new Error(`${name} declares non-canonical code ${code}`);
      }
    }
  });
});
