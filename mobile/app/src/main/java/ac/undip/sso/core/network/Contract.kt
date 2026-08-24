package ac.undip.sso.core.network

/**
 * Single mirror of BACKEND TRUTH for the mobile client: the error codes the
 * backend puts on its `{ message, code }` envelope. Source of truth:
 * `backend/src/auth/auth.service.ts`. The web mirrors the same set in
 * `web/src/api/contract.ts`, the extension in `core/contract.ts`.
 */
object BackendCodes {
    /** Upstream Kulon (Moodle) session expired server-side. */
    const val KULON_STALE = "KULON_STALE"

    /** Upstream SIAP session expired server-side. */
    const val SIAP_STALE = "SIAP_STALE"

    /** JWT failed validation (bad/expired token). */
    const val INVALID_TOKEN = "INVALID_TOKEN"

    /** Server-side session record is gone — silent refresh impossible. */
    const val SESSION_DEAD = "SESSION_DEAD"
}

/** Service-stale codes: upstream died while the JWT may still be valid. */
val SERVICE_STALE_CODES: Set<String> =
    setOf(BackendCodes.KULON_STALE, BackendCodes.SIAP_STALE)
