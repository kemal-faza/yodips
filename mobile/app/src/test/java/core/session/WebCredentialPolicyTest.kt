package ac.undip.sso.core.session

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Web credential policy (YD-MOBILE-001): the wasm /app/ client must never
 * persist upstream SIAP/Kulon cookies to browser storage. The JVM test runs in
 * the shared commonMain source set so the policy is exercised on every
 * androidUnitTest run — there is no wasmJsTest source set (repo policy: no
 * Node toolchain download).
 */
class WebCredentialPolicyTest {
    @Test
    fun `policy persists only the JWT on web`() {
        val out = webPersistableCredentials("jwt-1", "sia_app_session=SIAP", "MoodleSession=KULON")
        assertEquals(mapOf(WebCredentialKind.Jwt to "jwt-1"), out)
    }

    @Test
    fun `null JWT yields an empty map even when cookies are present`() {
        assertEquals(emptyMap<WebCredentialKind, String>(), webPersistableCredentials(null, "sia=1", "kulon=1"))
    }

    @Test
    fun `cookies alone never produce a persistable entry`() {
        assertEquals(emptyMap<WebCredentialKind, String>(), webPersistableCredentials(null, "sia=1", null))
    }

    @Test
    fun `only Jwt is web-persistable`() {
        assertTrue(isWebPersistable(WebCredentialKind.Jwt))
        assertFalse(isWebPersistable(WebCredentialKind.SiapCookie))
        assertFalse(isWebPersistable(WebCredentialKind.KulonCookie))
    }
}
