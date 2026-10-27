package ac.undip.sso.core.network

/**
 * The single source of user-facing copy for a failed request.
 *
 * Transport facts (HTTP status, response body, exception text) only CLASSIFY a
 * failure; they never become the sentence a user reads. Screens render
 * [forError] as the body and [title] as the heading, while contextual copy that
 * was deliberately written for a situation (recovery outcomes, scan results)
 * stays owned by the caller.
 *
 * Voice: informal "kamu", short sentences, no jargon. Mirror of the backend
 * copy in `backend/src/common/user-messages.ts`; keep the two aligned.
 */
object UserMessages {
    const val NETWORK = "Tidak dapat terhubung ke server. Periksa koneksimu lalu coba lagi."
    const val SERVER = "Server sedang bermasalah. Coba lagi sebentar lagi."
    const val THROTTLED = "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi."
    const val VALIDATION = "Data yang kamu kirim tidak valid."
    const val NOT_FOUND = "Data yang kamu minta tidak ditemukan."
    const val FORBIDDEN = "Akunmu tidak punya akses ke data ini."
    const val CONFLICT = "Data berubah di perangkat lain. Muat ulang lalu coba lagi."
    const val SESSION_ACTION = "Silakan login ulang untuk melanjutkan."
    const val SERVICE_STALE = "Sesi layananmu belum dapat dipulihkan. Coba lagi."
    const val UNPARSEABLE = "Respons server tidak dapat dibaca. Coba lagi."
    const val UNPROCESSABLE = "Permintaan tidak dapat diproses. Coba lagi."
    const val UNEXPECTED = "Terjadi kendala saat memuat data. Coba lagi."

    // Pairing and QR surfaces.
    const val QR_INVALID = "Kode QR tidak valid atau sudah kedaluwarsa."
    const val QR_NOT_FOUND = "Tidak ada QR yang terdeteksi pada foto. Coba foto lain atau scan langsung dengan kamera."
    const val PAIR_FAILED = "Gagal menghubungkan perangkatmu. Coba lagi."
    const val SCANNER_SETUP = "Kamera tidak dapat disiapkan. Coba lagi atau pilih foto dari galeri."
    const val SCANNER_UNAVAILABLE = "Kamera tidak tersedia di perangkat ini."
    const val SCANNER_START = "Kamera gagal dimulai. Tutup aplikasi lain lalu coba lagi."
    const val PHOTO_UNREADABLE = "Foto tidak dapat dibaca. Coba foto lain."

    // Android login WebView.
    const val LOGIN_PAGE = "Halaman login sedang bermasalah. Coba lagi sebentar lagi."

    /** Heading for a failed source; the body comes from [forError]. */
    fun title(type: ErrorType): String =
        when (type) {
            ErrorType.UNAUTHORIZED -> "Sesi berakhir"
            ErrorType.STALE_SESSION -> "Sesi SIAP/Kulon perlu diperbarui"
            ErrorType.SESSION_RECOVERED -> "Sesi sudah dipulihkan"
            ErrorType.RECOVERY_UNSUPPORTED -> "Pemulihan perlu dilanjutkan di Android"
            else -> "Tidak dapat memuat data"
        }

    /**
     * Body copy for a failed request. `status`/`code` decide the nuance; the
     * raw response text is deliberately not a parameter.
     */
    fun forError(
        type: ErrorType,
        status: Int? = null,
        code: String? = null,
    ): String =
        when {
            type == ErrorType.UNAUTHORIZED || code == BackendCodes.SESSION_DEAD -> SESSION_ACTION
            type == ErrorType.STALE_SESSION -> SERVICE_STALE
            type == ErrorType.NETWORK -> NETWORK
            status == 401 -> SESSION_ACTION
            status == 403 -> FORBIDDEN
            status == 404 -> NOT_FOUND
            status == 409 -> CONFLICT
            status == 429 -> THROTTLED
            status == 422 -> UNPROCESSABLE
            status != null && status >= 500 -> SERVER
            status == 400 -> if (type == ErrorType.UPSTREAM) UNPROCESSABLE else VALIDATION
            type == ErrorType.NOT_FOUND -> NOT_FOUND
            type == ErrorType.UPSTREAM -> UNPROCESSABLE
            else -> UNEXPECTED
        }
}
