package ac.undip.sso.core.login

import ac.undip.sso.nowMs
import kotlin.io.encoding.Base64

/**
 * Pure, JVM-testable helpers for the in-app WebView login cascade:
 *
 *   SSO (Microsoft OIDC-backed) → Kulon → SIAP → handoff
 *
 * The cascade runs in a single WebView that also collects every session cookie
 * into the shared CookieManager, then `POST /api/auth/session/handoff`.
 *
 * Why these helpers exist: Undip SSO delegates its actual sign-in to Microsoft
 * (`/auth/user/login` 302-redirects to `login.microsoftonline.com`), and every
 * page in the cascade drops its own guest session cookie before the user has
 * logged in (CodeIgniter `ci_session_sso`, pre-auth `MoodleSession`). So the
 * login WebView must (a) NOT hard-block non-`undip.ac.id` hosts or the
 * Microsoft sign-in can never render, and (b) NOT advance a phase merely
 * because a guest cookie is present. The rules below encode both invariants.
 */
object LoginUrls {
    /** Real SSO login entry — OIDC decrypts it to Microsoft then back here. */
    const val SSO_LOGIN = "https://sso.undip.ac.id/auth/user/login"
}

/**
 * SSO bootstrap ticket (mirrors backend `SSOTicketService.generateTicket`):
 * base64 of the current unix-seconds as a string. Kulon/SIAP validate this
 * against the SSO session to mint their own session cookie.
 */
fun generateSsoTicket(): String =
    Base64.Default.encode(
        (nowMs() / 1000).toString().encodeToByteArray(),
    )

/** Kulon SSO bridge URL — establishes the Moodle session from the SSO ticket. */
fun kulonTicketUrl(ticket: String): String = "https://kulon2.undip.ac.id/auth/oidc/?t=$ticket"

/** SIAP SSO bridge URL — establishes the Laravel session from the SSO ticket. */
fun siapTicketUrl(ticket: String): String = "https://siap.undip.ac.id/sso/login?t=$ticket"

/** Microsoft OAuth tenant domains the sign-in can legitimately visit.
 *  Subdomains are allowed (e.g. `login.microsoftonline.com`, `*.msftauth.net`). */
private val MS_HOSTS =
    setOf(
        "login.microsoftonline.com",
        "login.live.com",
        "account.microsoft.com",
        "login.microsoft.com",
        "msftauth.net",
        "aadcdn.msauth.net",
        "aadsignin.microsoftonline.com",
        "sts.microsoftonline.com",
        "login.msa.akadns.net",
        "graph.microsoft.com",
    )

/**
 * True when the WebView may load a host as part of the SSO/Microsoft sign-in.
 * Every `undip.ac.id` host plus the Microsoft OIDC domains is allowed; anything
 * else (arbitrary external sites) is blocked so the flow stays on the login.
 */
fun isAllowedLoginHost(host: String): Boolean {
    val h = host.lowercase()
    // exact host or proper subdomain boundary — `evilundip.ac.id` must NOT match
    if (h == "undip.ac.id" || h.endsWith(".undip.ac.id")) return true
    return MS_HOSTS.any { h == it || h.endsWith(".$it") }
}

/** True when the URL is on the SSO home (not a Microsoft authorize page). */
fun isSsoHost(url: String?): Boolean {
    val u = url ?: return false
    // Exact origin boundary — `sso.undip.ac.id.evil.example` must NOT match.
    return u == "https://sso.undip.ac.id" || u.startsWith("https://sso.undip.ac.id/")
}

/** True when the URL is the SSO login form (host SSO + login path). */
fun isSsoLoginPage(url: String?): Boolean {
    val u = url ?: return false
    if (!isSsoHost(u)) return false
    val path = u.substringAfter("://sso.undip.ac.id").substringBefore("?").trimEnd('/')
    return path.endsWith("login")
}

/** True when the URL is an authenticated Kulon content page — excludes the
 *  login page AND the SSO-ticket/bootstrap path (`/auth/oidc`), so the hop
 *  does not advance prematurely before the Moodle session is established. */
fun isAuthenticatedKulonUrl(url: String?): Boolean {
    val u = url ?: return false
    if (!u.startsWith("https://kulon2.undip.ac.id")) return false
    val path = u.substringBefore("?")
    return !path.contains("/login") && !path.contains("/auth")
}

/** True when the URL is an authenticated SIAP content page (not its login). */
fun isAuthenticatedSiapUrl(url: String?): Boolean {
    val u = url ?: return false
    if (!u.startsWith("https://siap.undip.ac.id")) return false
    return !u.substringBefore("?").contains("/login")
}

/** Extract the lowercase host (without scheme/port) from a URL. */
private fun hostOf(url: String): String =
    url
        .substringAfter("://", "")
        .substringBefore("/")
        .substringBefore(":")
        .lowercase()

/** True when the URL is an interactive Microsoft OAuth page. */
fun isMicrosoftAuthorize(url: String?): Boolean {
    val h = url?.let(::hostOf) ?: return false
    return MS_HOSTS.any { h == it || h.endsWith(".$it") }
}

/**
 * Whether the SSO hop is actually complete and we may advance to Kulon.
 *
 * The SSO page drops a guest `ci_session_sso` the moment it loads, and for an
 * unauthenticated visitor it briefly round-trips to Microsoft (prompt=none) and
 * bounces straight back to the CLEAN login page (`/auth/user/login`) — so
 * neither cookie presence nor "returned from Microsoft" alone proves a login.
 * A REAL sign-in yields either an OIDC success return (`...?code=...`) or a
 * post-login SSO page (not the login path). Everything else is a bounce and
 * must NOT advance (otherwise the WebView leaves the login page mid-sign-in).
 *
 * @param seenMicrosoft  we have already navigated to a Microsoft authorize page
 *                       during this attempt (tracked by the caller)
 * @param hasSsoCookie   the SSO session cookie is currently present
 */
fun ssoLoginCompleted(
    url: String?,
    seenMicrosoft: Boolean,
    hasSsoCookie: Boolean,
): Boolean {
    val u = url ?: return false
    if (!isSsoHost(u) || !seenMicrosoft || !hasSsoCookie) return false
    if (queryParam(u, "code") != null) return true // OIDC success return
    if (queryParam(u, "error") != null) return false // prompt=none interaction bounce
    return !isSsoLoginPath(u) // a genuine post-login page (not the login form)
}

/** Whether an explicit Kulon recovery may use the already-authenticated SSO dashboard. */
fun ssoRecoveryLoginCompleted(
    url: String?,
    seenMicrosoft: Boolean,
    hasSsoCookie: Boolean,
    hasAuthenticatedDashboardMarker: Boolean,
): Boolean {
    val u = url ?: return false
    if (!isSsoHost(u)) return false
    if (ssoLoginCompleted(u, seenMicrosoft, hasSsoCookie)) return true
    if (!hasSsoCookie || !hasAuthenticatedDashboardMarker || queryParam(u, "error") != null) {
        return false
    }
    val landing = u.substringBefore('#').substringBefore('?').removeSuffix("/")
    return landing == "https://sso.undip.ac.id/pages/dashboard"
}

/**
 * Keep a resumed interaction redirect only when the Kulon capture classifier
 * flags the navigation as an interaction page: https on an allowlisted host
 * (undip.ac.id or the Microsoft sign-in domains). This is a host-level
 * allowlist, not an authorize-path match — Microsoft and SSO keep flow state
 * on several paths under those hosts (`/kmsi`, tenant-specific authorize
 * URLs, `?code=` returns), and matching shapes here already broke the live
 * A55 flow once. The value stays in memory and is only loaded after an
 * explicit user CTA.
 */
fun resumeKulonInteractionUrl(url: String?): String? =
    url?.takeIf { classifyKulonCaptureNavigation(it) == KulonCaptureOutcome.INTERACTION_REQUIRED }

/**
 * After the interactive SSO hop the browser can land straight on an
 * authenticated Kulon page without pausing on an SSO page of its own (observed
 * on A55: Microsoft → SSO callback → Kulon `/my/`). A Kulon landing candidate
 * is the signal that the SSO hop is done, so the caller can mint the ticket
 * exactly like [ssoLoginCompleted] does for an SSO landing. The landing probe
 * still has to expose the authenticated marker before the cookie is submitted
 * to the backend, which re-validates it upstream.
 */
fun shouldStartKulonTicketAfterSso(url: String?): Boolean =
    classifyKulonCaptureNavigation(url) == KulonCaptureOutcome.LANDING_CANDIDATE

/** Percent-decode a URL-encoded string (replaces java.net.URLDecoder). */
private fun percentDecode(s: String): String {
    val sb = StringBuilder(s.length)
    var i = 0
    while (i < s.length) {
        val c = s[i]
        when {
            c == '+' -> sb.append(' ')
            c == '%' && i + 2 < s.length -> {
                val hex = s.substring(i + 1, i + 3)
                sb.append(hex.toInt(16).toChar())
                i += 2
            }
            else -> sb.append(c)
        }
        i++
    }
    return sb.toString()
}

/** Extract a query parameter (URL-decoded) or null when absent. */
private fun queryParam(
    url: String,
    name: String,
): String? {
    val qIdx = url.indexOf('?')
    if (qIdx < 0) return null
    val q = url.substring(qIdx + 1)
    val pair = q.split('&').firstOrNull { it.startsWith("$name=") } ?: return null
    return percentDecode(pair.substringAfter('='))
}

/** True when the SSO URL is (still) the login form; a login bounce must stay here. */
private fun isSsoLoginPath(url: String): Boolean {
    val path = url.substringAfter("://sso.undip.ac.id").substringBefore('?').trimEnd('/')
    return path.endsWith("login")
}
