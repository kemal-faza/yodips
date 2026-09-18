package ac.undip.sso.core.network

import kotlin.io.encoding.Base64

/**
 * Baca klaim `exp` (unix detik) dari payload JWT, atau null bila token bukan
 * JWT 3-segmen / payload tak ter-decode / `exp` absen.
 *
 * Dipakai untuk refresh PROAKTIF: token yang tinggal ≤ leeway detik dirotasi
 * sebelum request berikutnya, sehingga sesi yang sebenarnya masih hidup tidak
 * perlu memicu 401 (dan dialog "Sesi Berakhir" yang non-dismissible) dulu.
 *
 * Signature TIDAK diverifikasi di sini — itu tugas backend. Fungsi ini murni
 * membaca klaim untuk keputusan lokal "perlu refresh sekarang atau tidak".
 */
fun jwtExpiryEpochSeconds(token: String): Long? {
    val parts = token.split('.')
    if (parts.size != 3) return null
    val payload = parts[1]
    if (payload.isEmpty()) return null
    // base64url JWT membuang padding; kembalikan sebelum decode.
    val padded = payload + "=".repeat((4 - payload.length % 4) % 4)
    val json =
        runCatching { Base64.UrlSafe.decode(padded).decodeToString() }.getOrNull()
            ?: return null
    val match = Regex("\"exp\"\\s*:\\s*(\\d+)").find(json) ?: return null
    return match.groupValues[1].toLongOrNull()
}
