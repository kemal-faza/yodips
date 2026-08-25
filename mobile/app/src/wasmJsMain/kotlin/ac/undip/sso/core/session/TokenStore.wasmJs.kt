package ac.undip.sso.core.session

import ac.undip.sso.core.data.TokenStoreLike
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

class TokenStore(
    private val cipher: TokenCipher = WasmJsTokenCipher(),
) : TokenStoreLike {
    private val _jwt = MutableStateFlow<String?>(rawGet(JWT_KEY)?.let { cipher.decrypt(it) })
    private val _siap = MutableStateFlow<String?>(rawGet(SIAP_KEY)?.let { cipher.decrypt(it) })
    private val _kulon = MutableStateFlow<String?>(rawGet(KULON_KEY)?.let { cipher.decrypt(it) })

    override val siapCookie: Flow<String?> = _siap.asStateFlow()
    override val kulonCookie: Flow<String?> = _kulon.asStateFlow()

    override suspend fun save(token: String, siap: String?, kulon: String?) {
        rawSet(JWT_KEY, cipher.encrypt(token))
        if (siap != null) { rawSet(SIAP_KEY, cipher.encrypt(siap)); _siap.value = siap }
        if (kulon != null) { rawSet(KULON_KEY, cipher.encrypt(kulon)); _kulon.value = kulon }
        _jwt.value = token
    }

    override suspend fun currentToken(): String? = _jwt.value

    override suspend fun clear() {
        rawRemove(JWT_KEY); rawRemove(SIAP_KEY); rawRemove(KULON_KEY)
        _jwt.value = null; _siap.value = null; _kulon.value = null
    }

    private fun rawGet(key: String): String? = jsLocalStorageGetItem(key)
    private fun rawSet(key: String, value: String) { jsLocalStorageSetItem(key, value) }
    private fun rawRemove(key: String) { jsLocalStorageRemoveItem(key) }

    companion object {
        private const val JWT_KEY = "sso_token"
        private const val SIAP_KEY = "sso_siap_cookie"
        private const val KULON_KEY = "sso_kulon_cookie"
    }
}

@JsFun("(key) => localStorage.getItem(key)")
private external fun jsLocalStorageGetItem(key: String): String?

@JsFun("(key, value) => localStorage.setItem(key, value)")
private external fun jsLocalStorageSetItem(key: String, value: String)

@JsFun("(key) => localStorage.removeItem(key)")
private external fun jsLocalStorageRemoveItem(key: String)