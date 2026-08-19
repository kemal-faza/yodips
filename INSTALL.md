# Instalasi (tanpa clone repo)

Semua artefak rilis di-host sebagai **GitHub Release** di tab *Releases* repo ini
(`https://github.com/kemal-faza/sso/releases`). User cukup download file dari
sana — tidak perlu `git clone`.

## Android — App `Undip SSO`

1. Buka tab **Releases**, pilih versi terbaru (tag `vX.Y.Z`).
2. Download file **`undip-sso-v<X.Y.Z>.apk`**.
3. Buka file itu di HP. Android akan minta izin "instal dari sumber tidak
dikenal" — aktifkan (contoh: *Settings > Apps > Special access > Install
unknown apps* untuk browser/file manager) lalu instal.
4. **Update berikutnya:** cukup download APK versi baru dan instal — Android
akan **meng-upgrade in-place** (data tidak hilang) selama APK memeberi tanda
tangan (signing key) yang sama (ini alasan rilis harus pakai satu keystore
release yang konsisten).

> Verifikasi integritas (optional): bandingkan hash file dengan `SHA256SUMS.txt`
> di Release:
> `sha256sum undip-sso-vX.Y.Z.apk`

## Extension Chrome/Edge — `Undip SSO Login`

Untuk install manual dari source (atau saat extension belum terpublish di
Chrome Web Store):

1. Download **`undip-sso-ext-v<X.Y.Z>.zip`** dari Release, ekstrak ke folder.
2. Buka `chrome://extensions` (Chrome) / `edge://extensions` (Edge).
3. Aktifkan **Developer mode**, klik **Load unpacked**, pilih folder hasil
ekstraksi (folder berisi `manifest.json`).
4. (Opsional) Jika sudah terpublish di Chrome Web Store, user meng-install
langsung dari store dan Chrome auto-update otomatis.

## Troubleshooting

- **APK tidak bisa di-upgrade** → tandatangan berbeda; pastikan rilis baru
dibuild dengan keystore release yang sama (lihat `mobile/keystore.properties.example`).
- **Extension tidak muncul / tidak jalan** → pastikan folder hasil ekstrak punya
`manifest.json` di akar, dan `dist/` ada.
