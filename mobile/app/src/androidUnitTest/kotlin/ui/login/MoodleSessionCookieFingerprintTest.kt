package ac.undip.sso.ui.login

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class MoodleSessionCookieFingerprintTest {
    @Test
    fun `fingerprints base and suffixed Moodle session cookies without retaining values`() {
        val exact = fingerprintMoodleSessionCookieHeader("MoodleSession=VALUE_A; unrelated=ignored")
        val suffixed = fingerprintMoodleSessionCookieHeader("MoodleSession_1=VALUE_B; unrelated=ignored")

        assertNotNull(exact)
        assertNotNull(suffixed)
        assertNotEquals(exact, suffixed)
        assertFalse(exact!!.contains("VALUE_A"))
        assertFalse(suffixed!!.contains("VALUE_B"))
    }

    @Test
    fun `ignores unrelated and empty Moodle cookies`() {
        assertNull(fingerprintMoodleSessionCookieHeader("unrelated=VALUE"))
        assertNull(fingerprintMoodleSessionCookieHeader("MoodleSession=; other=value"))
    }
}
