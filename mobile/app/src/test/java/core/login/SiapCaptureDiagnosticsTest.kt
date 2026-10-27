package ac.undip.sso.core.login

import org.junit.Assert.assertEquals
import org.junit.Test

class SiapCaptureDiagnosticsTest {
    @Test
    fun `classifies SIAP ticket navigation without accepting login or foreign hosts`() {
        assertEquals(KulonCaptureOutcome.CAPTURE_IN_PROGRESS,
            classifySiapCaptureNavigation("https://siap.undip.ac.id/sso/login?t=secret"))
        assertEquals(KulonCaptureOutcome.LANDING_CANDIDATE,
            classifySiapCaptureNavigation("https://siap.undip.ac.id/pages/mhs/dashboard"))
        assertEquals(KulonCaptureOutcome.INTERACTION_REQUIRED,
            classifySiapCaptureNavigation("https://login.microsoftonline.com/authorize"))
        assertEquals(KulonCaptureOutcome.INTERACTION_REQUIRED,
            classifySiapCaptureNavigation("https://sso.undip.ac.id/auth/user/login"))
        assertEquals(KulonCaptureOutcome.EXTERNAL_HOST,
            classifySiapCaptureNavigation("https://siap.undip.ac.id.attacker.example/pages/mhs/dashboard"))
    }
}
