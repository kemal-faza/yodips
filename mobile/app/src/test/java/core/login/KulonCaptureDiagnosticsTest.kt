package ac.undip.sso.core.login

import org.junit.Assert.assertEquals
import org.junit.Test

class KulonCaptureDiagnosticsTest {
    @Test
    fun `classifies authenticated Kulon pages and login redirects`() {
        assertEquals(
            KulonCaptureOutcome.AUTHENTICATED,
            classifyKulonCaptureNavigation("https://kulon2.undip.ac.id/my/?sesskey=secret-ticket"),
        )
        assertEquals(
            KulonCaptureOutcome.CAPTURE_IN_PROGRESS,
            classifyKulonCaptureNavigation("https://kulon2.undip.ac.id/auth/oidc/?t=secret-ticket"),
        )
        assertEquals(
            KulonCaptureOutcome.INTERACTION_REQUIRED,
            classifyKulonCaptureNavigation("https://kulon2.undip.ac.id/login/index.php?return=secret"),
        )
        assertEquals(
            KulonCaptureOutcome.INTERACTION_REQUIRED,
            classifyKulonCaptureNavigation("https://login.microsoftonline.com/tenant/oauth2/authorize?code=secret"),
        )
        assertEquals(
            KulonCaptureOutcome.INTERACTION_REQUIRED,
            classifyKulonCaptureNavigation("https://sso.undip.ac.id/auth/user/login?ticket=secret"),
        )
    }

    @Test
    fun `unknown Kulon paths never classify as authenticated`() {
        listOf(
            "https://kulon2.undip.ac.id/course/view.php?id=123",
            "https://kulon2.undip.ac.id/my/courses.php",
            "https://kulon2.undip.ac.id/auth/other",
        ).forEach { url ->
            assertEquals(KulonCaptureOutcome.UNKNOWN_PATH, classifyKulonCaptureNavigation(url))
        }
    }

    @Test
    fun `authenticated landing requires known path and sesskey marker`() {
        assertEquals(
            KulonCaptureOutcome.AUTHENTICATED,
            classifyKulonCaptureLanding(
                "https://kulon2.undip.ac.id/my/",
                hasSesskeyMarker = true,
                hasNewMoodleSessionCookie = true,
            ),
        )
        assertEquals(
            KulonCaptureOutcome.UNVERIFIED_LANDING,
            classifyKulonCaptureLanding(
                "https://kulon2.undip.ac.id/my/",
                hasSesskeyMarker = false,
                hasNewMoodleSessionCookie = true,
            ),
        )
        assertEquals(
            KulonCaptureOutcome.UNVERIFIED_LANDING,
            classifyKulonCaptureLanding(
                "https://kulon2.undip.ac.id/my/",
                hasSesskeyMarker = true,
                hasNewMoodleSessionCookie = false,
            ),
        )
        assertEquals(
            KulonCaptureOutcome.UNKNOWN_PATH,
            classifyKulonCaptureLanding(
                "https://kulon2.undip.ac.id/course/view.php",
                hasSesskeyMarker = true,
                hasNewMoodleSessionCookie = true,
            ),
        )
    }

    @Test
    fun `timeout and main-frame network failure map to distinct terminal outcomes`() {
        assertEquals(
            KulonCaptureOutcome.TIMEOUT,
            classifyKulonCaptureFailure(KulonCaptureFailure.TIMEOUT),
        )
        assertEquals(
            KulonCaptureOutcome.NETWORK_FAILURE,
            classifyKulonCaptureFailure(KulonCaptureFailure.NETWORK),
        )
    }

    @Test
    fun `classifies unsupported and external locations without trusting lookalike hosts`() {
        assertEquals(
            KulonCaptureOutcome.EXTERNAL_HOST,
            classifyKulonCaptureNavigation("https://kulon2.undip.ac.id.evil.example/my/"),
        )
        assertEquals(
            KulonCaptureOutcome.EXTERNAL_HOST,
            classifyKulonCaptureNavigation("http://kulon2.undip.ac.id/my/"),
        )
        assertEquals(
            KulonCaptureOutcome.EXTERNAL_HOST,
            classifyKulonCaptureNavigation("https://evil.example/path"),
        )
        assertEquals(KulonCaptureOutcome.EXTERNAL_HOST, classifyKulonCaptureNavigation(null))
    }

    @Test
    fun `redactor keeps only allowlisted static paths and removes query fragment and identity`() {
        val inputs = listOf(
            "https://kulon2.undip.ac.id/auth/oidc/?t=TOP_SECRET#NIM24060121130000",
            "https://kulon2.undip.ac.id/user/profile.php/24060121130000?ticket=TOP_SECRET",
            "https://evil.example/24060121130000?cookie=TOP_SECRET",
            "https://user:password@kulon2.undip.ac.id/my/?MoodleSession=TOP_SECRET",
            "https://kulon2.undip.ac.id/login/index.php?return=TOP_SECRET",
            "https://login.microsoftonline.com/tenant/oauth2/authorize?code=TOP_SECRET",
            "https://kulon2.undip.ac.id/course/view.php?id=NIM24060121130000&sesskey=TOP_SECRET",
        )
        val outputs = inputs.map(::redactKulonCaptureLocation)
        val joined = outputs.joinToString("\n")

        assertEquals("https://kulon2.undip.ac.id/auth/oidc", outputs[0])
        assertEquals("https://kulon2.undip.ac.id/[redacted]", outputs[1])
        assertEquals("location=external", outputs[2])
        assertEquals("https://kulon2.undip.ac.id/my/", outputs[3])
        assertEquals("https://kulon2.undip.ac.id/login/index.php", outputs[4])
        assertEquals("https://login.microsoftonline.com/[redacted]", outputs[5])
        assertEquals("https://kulon2.undip.ac.id/[redacted]", outputs[6])
        listOf("TOP_SECRET", "24060121130000", "MoodleSession", "cookie=", "password").forEach {
            org.junit.Assert.assertFalse(joined.contains(it))
        }
    }
}
