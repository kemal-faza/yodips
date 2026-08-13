# DESIGN.md — Undip SSO Design System (web)

> Kondisi: **current** (verifikasi dari `web/src/assets/css/main.css`, 2026-08-14).
> Dokumen ini adalah satu-satunya sumber kebenaran design system; `mobile/` dan
> `design-reference/mobile/` mengikuti token di sini.

## Identitas

- **Tone:** clean, modern, rounded, membantu. Sesi refactor "industrial" (flat,
  radius-0, Archivo/Inter/JetBrains) sudah **dibatalkan/kembali ke rounded
  normal** — file ini adalah state benar, bukan transisi.
- **Referensi visual mobile** (`design-reference/mobile/`): pakai untuk
  **layout & struktur layar** (header melengkung, bottom nav, bottom sheet),
  tapi palet & shape mengikuti token di file ini.
- **Sumber token:** `web/src/assets/css/main.css` (Tailwind v4 + shadcn-vue).

## Palet Warna

Semua hex/HSL berikut adalah nilai aktual dari `main.css`.

### Primary (brand) — **Teal**
| Token | Nilai | Pemakaian |
|-------|-------|-----------|
| `--primary` | `#01637e` | Tombol primer, aksen, header |
| `--primary-foreground` | `#ffffff` | Teks di atas primary |

`--primary` **sama di light & dark** (nilai hex penuh, JANGAN dibungkus `hsl()`).

### Neutrals — light
| Token | Nilai |
|-------|-------|
| `--background` | `0 0% 97%` (`hsl`) |
| `--foreground` | `0 0% 3.9%` |
| `--card` | `0 0% 100%` |
| `--secondary` | `0 0% 95%` |
| `--muted` | `0 0% 95%` |
| `--muted-foreground` | `0 0% 45.1%` |
| `--border` / `--input` | `0 0% 89.8%` |
| `--ring` | `0 0% 3.9%` |

### Neutrals — dark (`.dark`)
| Token | Nilai |
|-------|-------|
| `--background` | `0 0% 7%` |
| `--foreground` | `0 0% 98%` |
| `--card` | `0 0% 12%` |
| `--secondary` | `0 0% 15.5%` |
| `--muted-foreground` | `0 0% 63.9%` |
| `--border` / `--input` | `0 0% 18%` |
| `--ring` | `0 0% 83.1%` |

> Dark mode berbasis class: `.dark` pada `<html>` (FOUC guard + theme store + toggle).

### Semantik & status
| Token | Nilai | Pemakaian |
|-------|-------|-----------|
| `--color-warn` | `#f59e0b` | Peringatan, "segera" |
| `--color-gold` | `#ffc107` | Aksen emas (badge semester aktif) |
| `--color-success` | `#16a34a` | SKS, nilai, sukses |
| `--danger` | `#dc2626` (light) / `#f87171` (dark) | Keluar, error, terlambat |
| `--color-siap-from` | `#1e3a5f` | Gradient identitas SIAP |
| `--color-siap-to` | `#2d5aa0` | Gradient identitas SIAP |
| `--color-sso-green` | `#48bb78` | Status login SSO |
| `--color-sso-green-dark` | `#38a169` | |

### Chart (shadcn `/unovis`)
Chart light: `--chart-1..5` `12 76% 61% / 173 58% 39% / 197 37% 24% / 43 74% 66% / 27 87% 67%`.
Chart dark: `220 70% 50% / 160 60% 45% / 30 80% 55% / 280 65% 60% / 340 75% 55%`.
Palet distribusi nilai: A `#16a34a`, AB `#22c55e`, B `#3b82f6`, BC `#6366f1`, C `#f59e0b`, D `#f97316`, E `#dc2626`.

### Radius
- **`--radius`**: `0.5rem` (light **dan** dark) — rounded normal.
- Turunan: `--radius-sm` (minus 4px), `--radius-md` (minus 2px), `--radius-lg` (=radius), `--radius-xl` (+4px).

## Tipografi

- **Font:** **Geist** (400/500/600/700) — dimuat via `@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap')` di `web/src/assets/css/main.css` (bukan `<link>` di HTML).
  > **Catatan mobile:** Compose butuh sumber font sendiri (download/embed TTF Geist), bukan CSS `@import`.
- Sistem (`.dark`/light sama): `@theme inline` mendefinisikan `--font-sans`
  = system-ui stack, dan `--font-heading: var(--font-sans)` (heading = sans).

## Motion & Efek

- **Aurora background** — `--animate-aurora: aurora 60s linear infinite`;
  dipakai di halaman login. Ubah background-position 50%→350% tiap sumbu.
- `fade-in-up` (0.4s ease-out both) & `slide-in-right` (0.3s ease-out both).
- **MorphingText** — sapaan berubah (Inspira-style gooey), deck-shuffle acak
  non-repetitif, pakai SVG `<filter id="threshold">`.
- **SmoothCursor** — kursor spring mengikuti arah gerak (hanya saat
  `pointer: fine`).

## Interaksi & Utility

- Kursor global `pointer` untuk elemen interaktif (button/role=button/a/select/
  summary/label[for]/input submit), `not-allowed` saat disabled.
- shadcn-vue primitives (reka-ui): Button, Badge, Avatar, Alert, Sheet,
  Card, Input, Tabs, Select, Toggle, ToggleGroup, Skeleton, Separator,
  Dropdown, dll.
- Indikasi status via `StatusBadge` + dot kecil; kartu compact 1-baris dengan
  accent bar; tanggal relatif Indonesia (`formatRelativeDate`).

## Pola Layout (web)

- **Dashboard home `/`**: greeting (MorphingText "Halo/Hello/…" + nama penuh) →
  4 stat metrics (IPK gauge, SKS kumulatif `/144`, SKS semester `/24`, statistik
  tugas) → charts card (Tren IP / Distribusi Nilai / Akumulasi SKS, Unovis) →
  Jadwal → Tugas deadline terdekat (filter "Perlu Dikerjakan", 2×2) .
- **Sidebar** `AppSidebar`: Dashboard, Kulon, Profil; dark-mode toggle + bell
  notifikasi + avatar di header.
- **Kulon**: dashboard courses (search + filter pill + grid) & assignment detail.
- `ServiceGrid` (Layanan) **dihapus** dari beranda (2026-08-12).

## Mobile (acuan)

> Konsumsi token di atas. Struktur layar ikut `design-reference/mobile/`:
> header melengkung, bottom nav + FAB, bottom sheet detail. Dalam progress —
> lihat spec mobile terbaru.
