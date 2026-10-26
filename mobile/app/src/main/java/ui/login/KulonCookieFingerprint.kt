package ac.undip.sso.ui.login

import android.webkit.CookieManager
import java.security.MessageDigest

private const val KULON_ORIGIN = "https://kulon2.undip.ac.id/"

/**
 * Identity of the Moodle session cookie(s) in a `Cookie` header, as a SHA-256
 * digest. Used to answer "did the session change?" without ever retaining or
 * logging the cookie value itself.
 *
 * Kept in the MAIN source set (not with the probe harness in DEBUG) because it
 * carries no diagnostics and is unit-tested on both variants.
 */
internal fun fingerprintMoodleSessionCookieHeader(cookieHeader: String?): String? {
    val sessionCookies = cookieHeader
        ?.split(';')
        ?.mapNotNull { part ->
            val cookie = part.trim()
            val equalsAt = cookie.indexOf('=')
            if (equalsAt < 0) return@mapNotNull null
            val name = cookie.substring(0, equalsAt).trim()
            val value = cookie.substring(equalsAt + 1).trim()
            if (name.startsWith("MoodleSession") && value.isNotEmpty()) "$name=$value" else null
        }
        ?.sorted()
        ?.takeIf { it.isNotEmpty() }
        ?: return null
    return MessageDigest.getInstance("SHA-256")
        .digest(sessionCookies.joinToString(";").toByteArray())
        .joinToString("") { byte -> "%02x".format(byte) }
}

/** Fingerprint of the live Kulon session cookies in [cookieManager]. */
internal fun moodleSessionFingerprint(cookieManager: CookieManager): String? =
    fingerprintMoodleSessionCookieHeader(cookieManager.getCookie(KULON_ORIGIN))
