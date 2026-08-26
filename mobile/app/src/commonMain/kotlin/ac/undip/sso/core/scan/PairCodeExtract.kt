package ac.undip.sso.core.scan

/**
 * Ekstraksi kode pairing dari teks hasil scan QR / deep-link.
 *
 * Menerima salah satu bentuk:
 *  - kode polos:            "ABCD1234" / "abcd-1234"
 *  - URL dgn param `pair`:  "/login?pair=ABCD1234", absolut maupun relatif
 *
 * Normalisasi mirror backend `normalizePairingCode` & web
 * `utils/pairing.ts::extractPairCode` (uppercase, buang spasi/dash,
 * O->0, I/L->1). Mengembalikan kode ternormalisasi yang valid, atau null.
 */
fun extractPairCode(raw: String): String? {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return null

    // Param `pair` menang bila ada; potong di query/hash boundary atau spasi.
    val pairIdx = trimmed.indexOf("pair=")
    val candidate = if (pairIdx >= 0) {
        val start = pairIdx + "pair=".length
        val end = trimmed.indexOfAny(charArrayOf('&', '#', ' '), start)
        if (end > start) trimmed.substring(start, end)
        else trimmed.substring(start)
    } else {
        trimmed
    }

    val normalized = normalizePairCode(candidate)
    return if (isPairCodeShape(normalized)) normalized else null
}

/** Uppercase + buang pemisah + disambiguasi karakter mirip (O/I/L). */
private fun normalizePairCode(input: String): String =
    input.uppercase()
        .replace(" ", "")
        .replace("-", "")
        .replace('O', '0')
        .replace('I', '1')
        .replace('L', '1')

/** Alfabet Crockford 32 tanpa I/L/O/U, tepat 8 karakter. */
private fun isPairCodeShape(code: String): Boolean {
    if (code.length != PAIR_CODE_LEN) return false
    return code.all { it in PAIR_CODE_ALPHABET }
}

private const val PAIR_CODE_LEN = 8

// Sengaja string literal per-char agar tidak bergantung API JVM-only.
private const val PAIR_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
