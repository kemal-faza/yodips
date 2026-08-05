import { describe, expect, it, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useKulonSession } from './useKulonSession';
import { useAuthStore } from '../stores/auth';

vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));

describe('useKulonSession', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); });
  it('sets sessionExpired on 401/403', () => {
    const { sessionExpired, extract } = useKulonSession();
    const msg = extract({ response: { status: 401, data: { message: 'Session Kulon expired' } } });
    expect(sessionExpired.value).toBe(true);
    expect(msg).toBe('Session Kulon expired');
  });
  it('returns generic message for unknown', () => {
    const { sessionExpired, extract } = useKulonSession();
    expect(extract(new Error('boom'))).toBe('Terjadi kesalahan tidak diketahui.');
    expect(sessionExpired.value).toBe(false);
  });
});