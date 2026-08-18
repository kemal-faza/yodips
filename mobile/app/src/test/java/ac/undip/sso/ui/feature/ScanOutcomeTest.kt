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
    fun `success maps to a Berhasil Absen caption`() {
        val out = scanOutcome(ApiResult.Success(KehadiranResponse(status = "success", message = "Kehadiran tercatat")))
        assertTrue(out.success)
        assertEquals("Berhasil Absen", out.message)
    }

    @Test
    fun `success with blank status and no message still maps to Berhasil Absen`() {
        val out = scanOutcome(ApiResult.Success(KehadiranResponse(status = "", message = null)))
        assertTrue(out.success)
        assertEquals("Berhasil Absen", out.message)
    }

    @Test
    fun `non-success status without message maps to QR Code Invalid caption`() {
        val out = scanOutcome(ApiResult.Success(KehadiranResponse(status = "error", message = null)))
        assertFalse(out.success)
        assertEquals("QR Code Invalid", out.message)
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
    fun `UPSTREAM business rejection shows QR Code Invalid`() {
        val out = scanOutcome(ApiResult.Error(400, "", ErrorType.UPSTREAM))
        assertFalse(out.success)
        assertEquals("QR Code Invalid", out.message)
    }

    @Test
    fun `UPSTREAM ignores the raw SIAP message for a clean caption`() {
        val out =
            scanOutcome(
                ApiResult.Error(400, "Gagal: QRcode tidak valid atau sudah expired", ErrorType.UPSTREAM),
            )
        assertFalse(out.success)
        assertEquals("QR Code Invalid", out.message)
    }

    @Test
    fun `SERVER error uses the fallback text`() {
        val out = scanOutcome(ApiResult.Error(500, "boom", ErrorType.SERVER), fallback = "Coba lagi.")
        assertFalse(out.success)
        assertEquals("Coba lagi.", out.message)
    }
}
