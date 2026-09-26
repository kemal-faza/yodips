package ac.undip.sso.core.login

/** Outcomes exposed by the Android Kulon ticket diagnostic. */
enum class KulonCaptureOutcome {
    AUTHENTICATED,
    INTERACTION_REQUIRED,
    /** The SSO ticket endpoint is in flight; this is never a success state. */
    CAPTURE_IN_PROGRESS,
    /** An allowed host/path that is not a recognized Kulon landing or login. */
    UNKNOWN_PATH,
    /** The known `/my/` landing did not expose the expected authenticated marker. */
    UNVERIFIED_LANDING,
    EXTERNAL_HOST,
    TIMEOUT,
    NETWORK_FAILURE,
}

/** Terminal failures reported by Android WebView callbacks or the probe timer. */
enum class KulonCaptureFailure {
    TIMEOUT,
    NETWORK,
}

fun classifyKulonCaptureFailure(failure: KulonCaptureFailure): KulonCaptureOutcome =
    when (failure) {
        KulonCaptureFailure.TIMEOUT -> KulonCaptureOutcome.TIMEOUT
        KulonCaptureFailure.NETWORK -> KulonCaptureOutcome.NETWORK_FAILURE
    }

/**
 * A known `/my/` landing is authenticated only when Moodle's marker exists and
 * the direct-ticket flow installed a new session cookie.
 */
fun classifyKulonCaptureLanding(
    url: String?,
    hasSesskeyMarker: Boolean,
    hasNewMoodleSessionCookie: Boolean,
): KulonCaptureOutcome {
    val navigation = classifyKulonCaptureNavigation(url)
    return when (navigation) {
        KulonCaptureOutcome.AUTHENTICATED ->
            if (hasSesskeyMarker && hasNewMoodleSessionCookie) {
                KulonCaptureOutcome.AUTHENTICATED
            } else {
                KulonCaptureOutcome.UNVERIFIED_LANDING
            }
        else -> navigation
    }
}

/** URL-only navigation classification. Network errors and timeouts come from WebView callbacks. */
fun classifyKulonCaptureNavigation(url: String?): KulonCaptureOutcome {
    val parts = safeUrlParts(url) ?: return KulonCaptureOutcome.EXTERNAL_HOST
    if (parts.scheme != "https" || !isAllowedLoginHost(parts.host)) {
        return KulonCaptureOutcome.EXTERNAL_HOST
    }

    if (isMicrosoftAuthorize(url)) return KulonCaptureOutcome.INTERACTION_REQUIRED

    if (parts.host == "kulon2.undip.ac.id") {
        val path = parts.path.lowercase().trimEnd('/').ifEmpty { "/" }
        return when (path) {
            "/auth/oidc" -> KulonCaptureOutcome.CAPTURE_IN_PROGRESS
            "/login", "/login/index.php", "/auth/user/login" ->
                KulonCaptureOutcome.INTERACTION_REQUIRED
            "/my" -> KulonCaptureOutcome.AUTHENTICATED
            else -> KulonCaptureOutcome.UNKNOWN_PATH
        }
    }

    if (parts.host == "sso.undip.ac.id" &&
        parts.path.lowercase().trimEnd('/').endsWith("/login")
    ) {
        return KulonCaptureOutcome.INTERACTION_REQUIRED
    }

    return KulonCaptureOutcome.UNKNOWN_PATH
}

/**
 * Safe location string for debug logs. Only known static paths on HTTPS
 * allowlisted hosts survive; query, fragment, unknown path segments and
 * userinfo are never returned.
 */
fun redactKulonCaptureLocation(url: String?): String {
    val parts = safeUrlParts(url) ?: return "location=redacted"
    if (parts.scheme != "https" || !isAllowedLoginHost(parts.host)) {
        return "location=external"
    }

    val path = parts.path.trimEnd('/').ifEmpty { "/" }
    val safePath = SAFE_CAPTURE_PATHS[path] ?: "/[redacted]"
    return "https://${parts.host}$safePath"
}

private data class UrlParts(
    val scheme: String,
    val host: String,
    val path: String,
)

private fun safeUrlParts(url: String?): UrlParts? {
    if (url.isNullOrBlank() || url.any(Char::isWhitespace)) return null
    val schemeEnd = url.indexOf("://")
    if (schemeEnd <= 0) return null
    val scheme = url.substring(0, schemeEnd).lowercase()
    val authorityStart = schemeEnd + 3
    val authorityEnd = url.indexOfAny(charArrayOf('/', '?', '#'), authorityStart)
        .let { if (it < 0) url.length else it }
    val authority = url.substring(authorityStart, authorityEnd)
    if (authority.isBlank()) return null
    val host = authority.substringAfterLast('@').substringBefore(':').lowercase()
    if (host.isBlank()) return null
    val path = if (authorityEnd < url.length && url[authorityEnd] == '/') {
        url.substring(authorityEnd).substringBefore('?').substringBefore('#')
    } else {
        "/"
    }
    return UrlParts(scheme, host, path)
}

private val SAFE_CAPTURE_PATHS = mapOf(
    "/" to "/",
    "/auth/oidc" to "/auth/oidc",
    "/auth/user/login" to "/auth/user/login",
    "/user/login" to "/user/login",
    "/login/index.php" to "/login/index.php",
    "/my" to "/my/",
    "/dashboard" to "/dashboard",
    "/pages/mhs/dashboard" to "/pages/mhs/dashboard",
    "/sso/login" to "/sso/login",
)
