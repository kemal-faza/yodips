package ac.undip.sso.core.network

/**
 * Mirror of the backend's `{ message, code }` envelope error codes used by the
 * mobile client. Source of truth: `contract/backend-contract.json`
 * (backend `ERROR_CODES`), guarded by `backend/src/common/contract-drift.spec.ts`.
 * The web mirrors the codes in `web/src/api/contract.ts`, the extension in
 * `core/contract.ts`.
 *
 * Only the codes the client actually READS are declared here (no dead mirror):
 * [SERVICE_STALE_CODES] classifies upstream-stale 401s, and the login pairing
 * screen maps [INVALID_CODE]/[EXPIRED_CODE]/[SESSION_DEAD] to user messages.
 */
object BackendCodes {
    /** Upstream Kulon (Moodle) session expired server-side. */
    const val KULON_STALE = "KULON_STALE"

    /** Upstream SIAP session expired server-side. */
    const val SIAP_STALE = "SIAP_STALE"

    /** Pairing code is wrong or already consumed. */
    const val INVALID_CODE = "INVALID_CODE"

    /** Pairing code has expired. */
    const val EXPIRED_CODE = "EXPIRED_CODE"

    /** Server-side session record is gone — silent refresh impossible. */
    const val SESSION_DEAD = "SESSION_DEAD"
}

/** Service-stale codes: upstream died while the JWT may still be valid. */
val SERVICE_STALE_CODES: Set<String> =
    setOf(BackendCodes.KULON_STALE, BackendCodes.SIAP_STALE)

/** True when a backend error code marks the upstream (Kulon/SIAP) session dead. */
fun isServiceStaleCode(code: String?): Boolean = code != null && code in SERVICE_STALE_CODES
