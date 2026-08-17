package ac.undip.sso.ui.feature

import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.ErrorType
import ac.undip.sso.core.network.KehadiranResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScanOutcomeTest {
    // Success
    @Test
    fun `success with SIAP message shows the backend message`() {
        val out = scanOutcome(ApiResult.Success(KehadiranResponse(status = "success", message = "Kehadiran tercatat")))
        assertTrue(out.success)
        assertEquals("Kehadiran tercatat", out.message)
    }

    @Test
    fun `success with blank status and no message uses default success text`() {
        val out = scanOutcome(ApiResult.Success(KehadiranResponse(status = "", message = null)))
        assertTrue(out.success)
        assertEquals("Absensi berhasil dicatat. ✅", out.message)
    }

    @Test
    fun `non-success status without message maps to rejected QR text`() {
        val out = scanOutcome(ApiResult.Success(KehadiranResponse(status = "error", message = null)))
        assertFalse(out.success)
        assertTrue(out.message.contains("ditolak", ignoreCase = true))
    }

    // Errors
    @Test
    fun `UNAUTHORIZED prompts re-login`() {
        val out = scanOutcome(ApiResult.Error(401, "Unauthorized", ErrorType.UNAUTHORIZED))
        assertFalse(out.success)
        assertTrue(out.message.contains("login ulang", ignoreCase = true))
    }

    @Test
    fun `NETWORK error mentions connectivity`() {
        val out = scanOutcome(ApiResult.Error(null, "host unreachable", ErrorType.NETWORK))
        assertFalse(out.success)
        assertTrue(out.message.contains("server", ignoreCase = true))
    }

    @Test
    fun `UPSTREAM business error falls back to a QR-expired hint when message blank`() {
        val out = scanOutcome(ApiResult.Error(400, "", ErrorType.UPSTREAM))
        assertFalse(out.success)
        assertTrue(out.message.contains("kedaluwarsa", ignoreCase = true))
    }

    @Test
    fun `UPSTREAM with a real SIAP message is surfaced verbatim`() {
        val out =
            scanOutcome(
                ApiResult.Error(400, "Gagal: QRcode tidak valid atau sudah expired", ErrorType.UPSTREAM),
            )
        assertFalse(out.success)
        assertEquals("Gagal: QRcode tidak valid atau sudah expired", out.message)
    }

    @Test
    fun `SERVER error uses the fallback text`() {
        val out = scanOutcome(ApiResult.Error(500, "boom", ErrorType.SERVER), fallback = "Coba lagi.")
        assertFalse(out.success)
        assertEquals("Coba lagi.", out.message)
    }
}
