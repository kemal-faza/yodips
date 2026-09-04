package ac.undip.sso.core.session

/**
 * Web (wasm PWA) persistence policy — SECURITY INVARIANT (YD-MOBILE-001):
 * upstream SIAP/Kulon cookies are NEVER persisted in the browser. The wasm
 * client authenticates to the backend with the JWT only (KtorSsoApi sends
 * Bearer; handoff happens on the pairing device, not in this browser). Only
 * the JWT may survive a reload — localStorage `sso_token`, the same key the
 * SPA at `/` uses (risk-accepted in the security roadmap).
 *
 * Android (DataStore + AES-GCM Keystore) is a separate target with its own
 * rules ([TokenStore] in androidMain). This policy governs web targets only.
 */
enum class WebCredentialKind {
    Jwt,
    SiapCookie,
    KulonCookie,
}

/** Returns the subset of credentials allowed to persist on web: at most the JWT. */
fun webPersistableCredentials(
    jwt: String?,
    siap: String?,
    kulon: String?,
): Map<WebCredentialKind, String> {
    // siap/kulon deliberately ignored: never persisted on a web target.
    @Suppress("UNUSED_VARIABLE", "unused")
    val ignored = listOf(siap, kulon)
    return if (jwt != null) mapOf(WebCredentialKind.Jwt to jwt) else emptyMap()
}

/** Web persistence predicate: only the JWT kind is persistable. */
fun isWebPersistable(kind: WebCredentialKind): Boolean = kind == WebCredentialKind.Jwt
