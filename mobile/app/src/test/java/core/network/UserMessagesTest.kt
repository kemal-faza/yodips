package ac.undip.sso.core.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The catalog is the boundary between transport facts and user copy: whatever
 * status/type combination a screen receives, the sentence must read like a
 * person wrote it and must never expose a body, a field name or an exception.
 */
class UserMessagesTest {
    private val technical = listOf("{", "}", "statusCode", "Exception", "HTTP ", "undefined", "<html")

    @Test
    fun `every type and status yields human copy`() {
        for (type in ErrorType.entries) {
            for (status in listOf(null, 400, 401, 403, 404, 409, 422, 429, 500, 502)) {
                val message = UserMessages.forError(type, status)
                assertTrue("blank copy for $type/$status", message.isNotBlank())
                for (needle in technical) {
                    assertFalse("$type/$status leaked $needle: $message", message.contains(needle))
                }
            }
        }
    }

    @Test
    fun `status decides the nuance`() {
        assertEquals(UserMessages.SESSION_ACTION, UserMessages.forError(ErrorType.SERVER, 401))
        assertEquals(UserMessages.FORBIDDEN, UserMessages.forError(ErrorType.UPSTREAM, 403))
        assertEquals(UserMessages.NOT_FOUND, UserMessages.forError(ErrorType.SERVER, 404))
        assertEquals(UserMessages.CONFLICT, UserMessages.forError(ErrorType.UPSTREAM, 409))
        assertEquals(UserMessages.THROTTLED, UserMessages.forError(ErrorType.SERVER, 429))
        assertEquals(UserMessages.UNPROCESSABLE, UserMessages.forError(ErrorType.UPSTREAM, 422))
        assertEquals(UserMessages.SERVER, UserMessages.forError(ErrorType.SERVER, 500))
    }

    @Test
    fun `domain types win over the generic status fallback`() {
        assertEquals(UserMessages.NETWORK, UserMessages.forError(ErrorType.NETWORK))
        assertEquals(UserMessages.SERVICE_STALE, UserMessages.forError(ErrorType.STALE_SESSION, 401))
        assertEquals(
            UserMessages.SESSION_ACTION,
            UserMessages.forError(ErrorType.UNAUTHORIZED, 401, BackendCodes.SESSION_DEAD),
        )
        assertEquals(UserMessages.VALIDATION, UserMessages.forError(ErrorType.SERVER, 400))
        assertEquals(UserMessages.UNPROCESSABLE, UserMessages.forError(ErrorType.UPSTREAM, 400))
    }

    @Test
    fun `titles stay specific per recovery state`() {
        assertEquals("Sesi berakhir", UserMessages.title(ErrorType.UNAUTHORIZED))
        assertEquals("Sesi SIAP/Kulon perlu diperbarui", UserMessages.title(ErrorType.STALE_SESSION))
        assertEquals("Sesi sudah dipulihkan", UserMessages.title(ErrorType.SESSION_RECOVERED))
        assertEquals("Tidak dapat memuat data", UserMessages.title(ErrorType.SERVER))
    }
}
