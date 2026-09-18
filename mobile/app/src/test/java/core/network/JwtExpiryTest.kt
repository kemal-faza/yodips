package ac.undip.sso.core.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Base64

class JwtExpiryTest {
    private fun b64Url(json: String): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray())

    private fun jwt(payloadJson: String): String =
        "${b64Url("{\"alg\":\"HS256\"}")}.${b64Url(payloadJson)}.sig"

    @Test
    fun `reads exp from a valid JWT payload`() {
        assertEquals(1_700_000_000L, jwtExpiryEpochSeconds(jwt("{\"sub\":\"2404\",\"exp\":1700000000}")))
    }

    @Test
    fun `tolerates a payload that already carries padding`() {
        // Standard (not stripped) base64url includes '=' padding; the reader must
        // not double-pad it into an invalid string.
        val padded = Base64.getUrlEncoder().encodeToString("{\"exp\":123}".toByteArray())
        val token = "${b64Url("{}")}.$padded.sig"
        assertEquals(123L, jwtExpiryEpochSeconds(token))
    }

    @Test
    fun `payload without exp returns null`() {
        assertNull(jwtExpiryEpochSeconds(jwt("{\"sub\":\"2404\"}")))
    }

    @Test
    fun `not a three segment token returns null`() {
        assertNull(jwtExpiryEpochSeconds("garbage"))
        assertNull(jwtExpiryEpochSeconds("a.b"))
        assertNull(jwtExpiryEpochSeconds("a..c"))
    }

    @Test
    fun `undecodable payload returns null`() {
        assertNull(jwtExpiryEpochSeconds("a.@@@not-base64@@@.c"))
    }
}
