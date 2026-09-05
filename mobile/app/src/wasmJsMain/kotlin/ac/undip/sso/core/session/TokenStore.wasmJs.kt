package ac.undip.sso.core.session

import ac.undip.sso.core.data.TokenStoreLike
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * wasmJs (PWA `/app/`) token store. SECURITY INVARIANT (YD-MOBILE-001):
 * upstream SIAP/Kulon cookies are NEVER written to browser storage on web —
 * the wasm client authenticates to the backend with the JWT only. Only the
 * JWT may persist across reloads (localStorage `sso_token`, the same key the
 * SPA at `/` uses; roadmap risk acceptance for JWT-at-rest).
 *
 * The `siapCookie`/`kulonCookie` flows are always empty by design (the
 * [TokenStoreLike] shape is shared with Android, where cookies ARE persisted
 * encrypted in DataStore); `save()` ignores the cookie arguments entirely.
 * Legacy cookie keys from a previous PWA release are neither read nor written
 * and no refresh path re-writes them (see [SessionRefresher], which only
 * re-saves whatever the flows return — null here).
 */
internal interface WasmTokenStorage {
    fun get(key: String): String?
    fun set(key: String, value: String)
    fun remove(key: String)
}

private object BrowserLocalStorage : WasmTokenStorage {
    override fun get(key: String): String? = jsLocalStorageGetItem(key)
    override fun set(key: String, value: String) = jsLocalStorageSetItem(key, value)
    override fun remove(key: String) = jsLocalStorageRemoveItem(key)
}

class TokenStore private constructor(
    private val cipher: TokenCipher,
    private val storage: WasmTokenStorage,
) : TokenStoreLike {
    constructor() : this(WasmJsTokenCipher(), BrowserLocalStorage)

    internal constructor(storage: WasmTokenStorage) : this(WasmJsTokenCipher(), storage)

    private val _jwt = MutableStateFlow<String?>(storage.get(JWT_KEY)?.let { cipher.decrypt(it) })
    private val _siap = MutableStateFlow<String?>(null)
    private val _kulon = MutableStateFlow<String?>(null)

    override val siapCookie: Flow<String?> = _siap.asStateFlow()
    override val kulonCookie: Flow<String?> = _kulon.asStateFlow()

    override suspend fun save(token: String, siap: String?, kulon: String?) {
        // Policy: on web only the JWT is persistable; cookies are discarded.
        val allowed = webPersistableCredentials(token, siap, kulon)
        val jwt = allowed[WebCredentialKind.Jwt]
        if (jwt != null) {
            persistToken(cipher.encrypt(jwt))
            _jwt.value = jwt
        }
    }

    override suspend fun currentToken(): String? = _jwt.value

    /**
     * SYNCHRONOUS persisted-JWT removal (localStorage + flows reset).
     *
     * Logout-cleanup contract: [SessionLogout]'s `localCleanup` is
     * suspending, so the persisted session must be removable without a
     * suspension point inside the removal itself — INLINE, before the UI flips to the
     * logged-out state. A scheduled `GlobalScope.launch { clear() }` would
     * let the UI outrun the removal (a kill/restart in between resurrects
     * the session). The suspending [clear] delegates to this primitive so
     * both paths remove exactly the same state.
     */
    fun clearImmediately() {
        storage.remove(JWT_KEY)
        _jwt.value = null
        _siap.value = null
        _kulon.value = null
    }

    override suspend fun clear() = clearImmediately()

    private fun persistToken(value: String) {
        storage.set(JWT_KEY, value)
    }

    companion object {
        private const val JWT_KEY = "sso_token"
    }
}

@JsFun("(key) => localStorage.getItem(key)")
private external fun jsLocalStorageGetItem(key: String): String?

@JsFun("(key, value) => localStorage.setItem(key, value)")
private external fun jsLocalStorageSetItem(key: String, value: String)

@JsFun("(key) => localStorage.removeItem(key)")
private external fun jsLocalStorageRemoveItem(key: String)
