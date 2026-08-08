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
  it('relogin prefers the extension when installed; legacy login is the fallback', async () => {
    const loginViaExt = vi.fn().mockResolvedValue('started');
    const login = vi.fn().mockResolvedValue(undefined);
    (useAuthStore as any).mockReturnValue({
      loginViaExtension: loginViaExt,
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
      login,
      isAuthenticated: false,
    });
    const { relogin } = useKulonSession();
    const after = vi.fn().mockResolvedValue(undefined);
    await relogin(after);
    expect(loginViaExt).toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });
  it('relogin falls back to legacy capture when the extension is not installed', async () => {
    const loginViaExt = vi.fn().mockResolvedValue('not-installed');
    const login = vi.fn().mockResolvedValue(undefined);
    (useAuthStore as any).mockReturnValue({
      loginViaExtension: loginViaExt,
      isExtensionInstalled: vi.fn().mockResolvedValue(false),
      login,
      isAuthenticated: true,
    });
    const { relogin } = useKulonSession();
    const after = vi.fn().mockResolvedValue(undefined);
    await relogin(after);
    expect(login).toHaveBeenCalled();
    expect(after).toHaveBeenCalled();
  });
});