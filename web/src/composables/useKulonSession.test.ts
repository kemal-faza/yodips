import { describe, expect, it, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useKulonSession } from './useKulonSession';
import { useAuthStore } from '../stores/auth';
import { recoverUpstreamSession } from '../lib/upstream-renewal';

vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));
vi.mock('../lib/upstream-renewal', () => ({ recoverUpstreamSession: vi.fn() }));

describe('useKulonSession', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });
  it('sets sessionExpired on a 401 without assuming interactive login is needed', () => {
    const { sessionExpired, extract } = useKulonSession();
    const msg = extract({ response: { status: 401, data: { message: 'Session Kulon expired' } } });
    expect(sessionExpired.value).toBe(true);
    expect(msg).toBe('Sesi Kulon belum dapat digunakan. Coba pulihkan sesi.');
  });
  it('does not classify a 403 permission failure as a stale session', () => {
    const { sessionExpired, extract } = useKulonSession();
    expect(extract({ response: { status: 403, data: { message: 'Akses ditolak' } } })).toBe('Akunmu tidak punya akses ke data ini.');
    expect(sessionExpired.value).toBe(false);
  });
  it('returns generic message for unknown', () => {
    const { sessionExpired, extract } = useKulonSession();
    expect(extract(new Error('boom'))).toBe('Tidak dapat terhubung ke server. Periksa koneksimu lalu coba lagi.');
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
  it('retries the Kulon service without clearing the YoDips session', async () => {
    const clearSessionState = vi.fn();
    const fetchMe = vi.fn().mockResolvedValue('ok');
    const store = { clearSessionState, fetchMe, sessionVersion: 0 };
    (useAuthStore as any).mockReturnValue(store);
    vi.mocked(recoverUpstreamSession).mockResolvedValue('recovered');
    const { relogin, sessionExpired, error, extract } = useKulonSession();
    extract({ response: { status: 401, data: { message: 'x' } } });
    expect(sessionExpired.value).toBe(true);

    await relogin();

    expect(recoverUpstreamSession).toHaveBeenCalledWith('kulon');
    expect(clearSessionState).not.toHaveBeenCalled();
    expect(fetchMe).toHaveBeenCalled();
    expect(store.sessionVersion).toBe(1);
    expect(sessionExpired.value).toBe(false);
    expect(error.value).toBeNull();
  });
  it('keeps the session and offers retry when recovery is unavailable', async () => {
    const clearSessionState = vi.fn();
    (useAuthStore as any).mockReturnValue({ clearSessionState });
    vi.mocked(recoverUpstreamSession).mockResolvedValue('unavailable');
    const { relogin, sessionExpired, error, extract } = useKulonSession();
    extract({ response: { status: 401 } });
    await relogin();
    expect(clearSessionState).not.toHaveBeenCalled();
    expect(sessionExpired.value).toBe(true);
    expect(error.value).toContain('coba lagi');
  });
});
