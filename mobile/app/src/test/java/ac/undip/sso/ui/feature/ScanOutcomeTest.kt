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

    // Real-world SIAP success tokens are not the stable literal "success"; any
    // non-error status/message must map to a successful scan (no false "Gagal").
    @Test
    fun `Success status with a different casing maps to Berhasil Absen`() {
        val out = scanOutcome(ApiResult.Success(KehadiranResponse(status = "Success", message = "OK")))
        assertTrue(out.success)
        assertEquals("Berhasil Absen", out.message)
    }

    @Test
    fun `Sukses status maps to Berhasil Absen`() {
        val out = scanOutcome(ApiResult.Success(KehadiranResponse(status = "Sukses", message = "Kehadiran tercatat")))
        assertTrue(out.success)
        assertEquals("Berhasil Absen", out.message)
    }

    @Test
    fun `OK status maps to Berhasil Absen`() {
        val out = scanOutcome(ApiResult.Success(KehadiranResponse(status = "OK", message = null)))
        assertTrue(out.success)
        assertEquals("Berhasil Absen", out.message)
    }

    @Test
    fun `Berhasil status maps to Berhasil Absen`() {
        val out = scanOutcome(ApiResult.Success(KehadiranResponse(status = "Berhasil", message = null)))
        assertTrue(out.success)
        assertEquals("Berhasil Absen", out.message)
    }

    @Test
    fun `unknown status with a success-like message maps to Berhasil Absen`() {
        val out = scanOutcome(ApiResult.Success(KehadiranResponse(status = "1", message = "Berhasil absen tersimpan")))
        assertTrue(out.success)
        assertEquals("Berhasil Absen", out.message)
    }

    @Test
    fun `non-success status without message maps to QR Code Invalid caption`() {
        val out = scanOutcome(ApiResult.Success(KehadiranResponse(status = "error", message = null)))
        assertFalse(out.success)
        assertEquals("QR Code Invalid", out.message)
    }

    @Test
    fun `error status with different casing maps to QR Code Invalid`() {
        val out = scanOutcome(ApiResult.Success(KehadiranResponse(status = "Error", message = null)))
        assertFalse(out.success)
        assertEquals("QR Code Invalid", out.message)
    }

    @Test
    fun `Gagal status maps to QR Code Invalid`() {
        val out = scanOutcome(ApiResult.Success(KehadiranResponse(status = "Gagal", message = null)))
        assertFalse(out.success)
        assertEquals("QR Code Invalid", out.message)
    }

    @Test
    fun `status success but expired message still maps to QR Code Invalid`() {
        val out =
            scanOutcome(
                ApiResult.Success(
                    KehadiranResponse(status = "success", message = "Gagal: QRcode tidak valid atau sudah expired"),
                ),
            )
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
