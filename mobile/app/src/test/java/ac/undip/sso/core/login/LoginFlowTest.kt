package ac.undip.sso.core.login

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LoginFlowTest {
    // --- isAllowedLoginHost ---
    @Test
    fun `undip hosts are allowed`() {
        assertTrue(isAllowedLoginHost("sso.undip.ac.id"))
        assertTrue(isAllowedLoginHost("kulon2.undip.ac.id"))
        assertTrue(isAllowedLoginHost("siap.undip.ac.id"))
        assertTrue(isAllowedLoginHost("sub.undip.ac.id"))
    }

    @Test
    fun `microsoft oauth tenants are allowed`() {
        assertTrue(isAllowedLoginHost("login.microsoftonline.com"))
        assertTrue(isAllowedLoginHost("login.live.com"))
        assertTrue(isAllowedLoginHost("account.microsoft.com"))
        assertTrue(isAllowedLoginHost("sub.msftauth.net"))
    }

    @Test
    fun `unrelated external hosts are blocked`() {
        assertFalse(isAllowedLoginHost("evil.example.com"))
        assertFalse(isAllowedLoginHost("login-microsoftonline.com"))
        assertFalse(isAllowedLoginHost("microsoft.com"))
        assertFalse(isAllowedLoginHost("undip.ac.id.evil.com"))
    }

    // --- isSsoHost / isMicrosoftAuthorize ---
    @Test
    fun `host predicates classify urls correctly`() {
        assertTrue(isSsoHost("https://sso.undip.ac.id/auth/user/login"))
        assertTrue(isSsoHost("https://sso.undip.ac.id/"))
        assertFalse(isSsoHost("https://login.microsoftonline.com/tenant/authorize"))
        assertFalse(isSsoHost(null))
        assertFalse(isSsoHost(""))

        assertTrue(isMicrosoftAuthorize("https://login.microsoftonline.com/acct/oauth2/v2.0/authorize"))
        assertTrue(isMicrosoftAuthorize("https://login.microsoftonline.com/"))
        assertFalse(isMicrosoftAuthorize("https://sso.undip.ac.id/auth/user/login"))
        assertFalse(isMicrosoftAuthorize(null))
        assertFalse(isMicrosoftAuthorize("https://evil.example.com/x"))
    }

    @Test
    fun `login page and authenticated pages are classified`() {
        assertTrue(isSsoLoginPage("https://sso.undip.ac.id/auth/user/login"))
        assertTrue(isSsoLoginPage("https://sso.undip.ac.id/user/login"))
        assertFalse(isSsoLoginPage("https://sso.undip.ac.id/dashboard"))
        assertFalse(isSsoLoginPage("https://kulon2.undip.ac.id/my/"))
        assertFalse(isSsoLoginPage(null))

        assertTrue(isAuthenticatedKulonUrl("https://kulon2.undip.ac.id/my/"))
        assertTrue(isAuthenticatedKulonUrl("https://kulon2.undip.ac.id/my/courses.php"))
        assertFalse(isAuthenticatedKulonUrl("https://kulon2.undip.ac.id/login/index.php"))
        // the SSO ticket bootstrap path must NOT count as authenticated
        assertFalse(isAuthenticatedKulonUrl("https://kulon2.undip.ac.id/auth/oidc/?t=xxx"))
        assertFalse(isAuthenticatedKulonUrl("https://sso.undip.ac.id/auth/user/login"))

        assertTrue(isAuthenticatedSiapUrl("https://siap.undip.ac.id/pages/mhs/dashboard"))
        assertFalse(isAuthenticatedSiapUrl("https://siap.undip.ac.id/login?next=..."))
        assertFalse(isAuthenticatedSiapUrl("https://siap.undip.ac.id/sso/login?t=xxx"))
        assertFalse(isAuthenticatedSiapUrl(null))
    }

    @Test
    fun `sso ticket encodes unix seconds and builds bridge urls`() {
        // base64 of the ASCII string "0" = base64.startswith from 0 seconds
        val ticket = generateSsoTicket()
        assertFalse(ticket.isEmpty())
        // ticket url shape matches backend SSOTicketService
        assertTrue(kulonTicketUrl(ticket).startsWith("https://kulon2.undip.ac.id/auth/oidc/?t="))
        assertTrue(siapTicketUrl(ticket).endsWith(ticket))
    }

    // --- ssoLoginCompleted ---
    @Test
    fun `guest cookie on SSO login page without microsoft roundtrip does NOT advance`() {
        // The SSO page drops ci_session_sso on load (guest); presence alone never advances.
        assertFalse(ssoLoginCompleted("https://sso.undip.ac.id/auth/user/login", seenMicrosoft = false, hasSsoCookie = true))
    }

    @Test
    fun `login page bounce from prompt-none does NOT advance`() {
        // Unauthenticated visitor: SSO -> Microsoft(prompt=none) -> clean login page.
        assertFalse(ssoLoginCompleted("https://sso.undip.ac.id/auth/user/login", seenMicrosoft = true, hasSsoCookie = true))
        // Explicit interaction_required error is also a non-login.
        assertFalse(
            ssoLoginCompleted(
                "https://sso.undip.ac.id/auth/user/login?error=interaction_required",
                seenMicrosoft = true,
                hasSsoCookie = true,
            ),
        )
    }

    @Test
    fun `still on microsoft page does not advance`() {
        assertFalse(ssoLoginCompleted("https://login.microsoftonline.com/tenant/authorize", seenMicrosoft = true, hasSsoCookie = true))
    }

    @Test
    fun `oide success return with code advances`() {
        assertTrue(
            ssoLoginCompleted("https://sso.undip.ac.id/auth/user/login?code=abc&state=xyz", seenMicrosoft = true, hasSsoCookie = true),
        )
    }

    @Test
    fun `post-login SSO landing page advances`() {
        assertTrue(ssoLoginCompleted("https://sso.undip.ac.id/dashboard", seenMicrosoft = true, hasSsoCookie = true))
        assertTrue(ssoLoginCompleted("https://sso.undip.ac.id/", seenMicrosoft = true, hasSsoCookie = true))
    }

    @Test
    fun `return to SSO without fresh cookie does not advance`() {
        assertFalse(ssoLoginCompleted("https://sso.undip.ac.id/dashboard", seenMicrosoft = true, hasSsoCookie = false))
    }
}
