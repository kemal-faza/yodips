import { describe, expect, it, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useKulonSession } from './useKulonSession';
import { useAuthStore } from '../stores/auth';

vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));

const pushMock = vi.fn();
vi.mock('vue-router', () => ({ useRouter: () => ({ push: pushMock }) }));

describe('useKulonSession', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    pushMock.mockReset();
  });
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
  it('clear resets sessionExpired and error (regression)', () => {
    const { sessionExpired, error, extract, clear } = useKulonSession();
    extract({ response: { status: 401, data: { message: 'x' } } });
    error.value = 'boom';
    clear();
    expect(sessionExpired.value).toBe(false);
    expect(error.value).toBeNull();
  });
  it('relogin clears session state, resets local state, and navigates to /login', async () => {
    const clearSessionState = vi.fn();
    (useAuthStore as any).mockReturnValue({ clearSessionState });
    const { relogin, sessionExpired, error, extract } = useKulonSession();
    extract({ response: { status: 401, data: { message: 'x' } } });
    expect(sessionExpired.value).toBe(true);

    await relogin();

    expect(clearSessionState).toHaveBeenCalledTimes(1);
    expect(sessionExpired.value).toBe(false);
    expect(error.value).toBeNull();
    expect(pushMock).toHaveBeenCalledWith({ name: 'login' });
  });
});