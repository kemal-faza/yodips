package ac.undip.sso.core.login

/** Outcomes exposed by the Android Kulon ticket diagnostic. */
enum class KulonCaptureOutcome {
    AUTHENTICATED,
    INTERACTION_REQUIRED,
    /** The SSO ticket endpoint is in flight; this is never a success state. */
    CAPTURE_IN_PROGRESS,
    /** A known page that must be checked for authenticated or login markers. */
    LANDING_CANDIDATE,
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

enum class KulonLandingMarker {
    SESSKEY,
    LOGIN_FORM,
    UNKNOWN,
}

/** Decode the deliberately small string returned by the WebView marker probe. */
fun parseKulonLandingMarkerResult(result: String?): KulonLandingMarker =
    when (result?.trim()?.removeSurrounding("\"")) {
        "sesskey" -> KulonLandingMarker.SESSKEY
        "login" -> KulonLandingMarker.LOGIN_FORM
        else -> KulonLandingMarker.UNKNOWN
    }

fun classifyKulonCaptureFailure(failure: KulonCaptureFailure): KulonCaptureOutcome =
    when (failure) {
        KulonCaptureFailure.TIMEOUT -> KulonCaptureOutcome.TIMEOUT
        KulonCaptureFailure.NETWORK -> KulonCaptureOutcome.NETWORK_FAILURE
    }

/**
 * The known `/my/` and root landings are candidates only: authentication requires
 * Moodle's marker and a new session cookie. A login form at root requires interaction.
 */
fun classifyKulonCaptureLanding(
    url: String?,
    hasSesskeyMarker: Boolean,
    hasNewMoodleSessionCookie: Boolean,
    hasLoginFormMarker: Boolean = false,
): KulonCaptureOutcome =
    classifyKulonLanding(
        url = url,
        hasLoginFormMarker = hasLoginFormMarker,
        isAuthenticated = hasSesskeyMarker && hasNewMoodleSessionCookie,
    )

/**
 * Recovery acceptance for the interactive Kulon capture. The browser can
 * already hold a live Kulon cookie while the backend copy is stale (the
 * upstream rotated the session after the handoff snapshot); the ticket then
 * lands authenticated without rotating MoodleSession, so requiring a changed
 * cookie would block a valid recovery. The renewal endpoint re-validates the
 * cookie upstream and against the JWT identity before storing it, so a
 * sesskey landing without a login form is enough here.
 * [classifyKulonCaptureLanding] keeps the stricter new-cookie rule for the
 * silent-ticket diagnostic.
 */
fun classifyKulonRecoveryLanding(
    url: String?,
    hasSesskeyMarker: Boolean,
    hasLoginFormMarker: Boolean = false,
): KulonCaptureOutcome =
    classifyKulonLanding(
        url = url,
        hasLoginFormMarker = hasLoginFormMarker,
        isAuthenticated = hasSesskeyMarker,
    )

/** Shared landing contract; only the authenticated predicate differs per caller. */
private fun classifyKulonLanding(
    url: String?,
    hasLoginFormMarker: Boolean,
    isAuthenticated: Boolean,
): KulonCaptureOutcome {
    val navigation = classifyKulonCaptureNavigation(url)
    return when (navigation) {
        KulonCaptureOutcome.LANDING_CANDIDATE ->
            when {
                hasLoginFormMarker -> KulonCaptureOutcome.INTERACTION_REQUIRED
                isAuthenticated -> KulonCaptureOutcome.AUTHENTICATED
                else -> KulonCaptureOutcome.UNVERIFIED_LANDING
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
            "/", "/my" -> KulonCaptureOutcome.LANDING_CANDIDATE
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
