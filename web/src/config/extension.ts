/** ID extension "YoDips". Untuk dev load-unpacked, isi dari chrome://extensions
 *  ke web/.env sebagai ViteExtensionId (menggantikan placeholder). */
export const EXTENSION_ID: string = import.meta.env.VITE_EXTENSION_ID ?? "";

/**
 * Aktifkan jalur login interaktif `/api/auth/sso/capture` (Playwright buka
 * window di SERVER). Jalur ini single-admin / dev-only: ia memakai browser
 * server-side, cocok utk satu admin di dev, BUKAN utk login multi-user real
 * (user menangkap cookie-nya sendiri via extension/handoff/app).
 * Set `VITE_ENABLE_SSO_CAPTURE=true` HANYA di dev; biarkan false di produksi
 * supaya tombol "Login via SSO" tersembunyi dan pengguna memakai jalur yang
 * benar (extension desktop / app mobile / handoff).
 */
export const SSO_CAPTURE_ENABLED: boolean =
 import.meta.env.VITE_ENABLE_SSO_CAPTURE === "true";

/**
 * Deteksi pengguna di perangkat seluler. Di HP jalur `/sso/capture` (dan
 * extension) tidak relevan; sebaiknya diarahkan ke app native. Dipakai utk
 * menyembunyikan tombol interactive capture di layar kecil.
 */
export function isMobileUserAgent(ua: string = navigator.userAgent): boolean {
	return /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua);
}

/**
 * Predikat permukaan mobile utk AdaptiveRoute (spec §7): UA mobile ATAU PWA
 * standalone. OR sengaja — iPadOS 13+ melaporkan UA "Macintosh", jadi PWA
 * iPad ter-install hanya tertangkap kondisi standalone.
 */
export function isMobileDevice(): boolean {
  if (isMobileUserAgent()) return true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(display-mode: standalone)').matches;
}
