package ac.undip.sso.core.session

import ac.undip.sso.core.data.TokenStoreLike
import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/** Process-singleton DataStore backing [TokenStore] (see MainActivity wiring). */
internal val Context.tokenDataStore: DataStore<Preferences> by preferencesDataStore(name = "sso_session")

/**
 * Persist the JWT (and the raw per-source session cookies captured during
 * handoff) in jetpack DataStore, encrypted at rest via [cipher].
 *
 * Everything sensitive is wrapped by [TokenCipher] (on-device:
 * [KeystoreTokenCipher] with an Android-KeyStore-backed AES key), so a raw
 * backup / rooted device / file read exposes only ciphertext. A value that
 * cannot be decrypted (tampered, wrong key, or legacy pre-encryption plaintext)
 * is treated as absent — fail-closed: never trust an unverifiable credential,
 * always fall back to a fresh login.
 */
class TokenStore(
    private val dataStore: DataStore<Preferences>,
    private val cipher: TokenCipher,
) : TokenStoreLike {
    private object Keys {
        val JWT = stringPreferencesKey("jwt")
        val SIAP_COOKIE = stringPreferencesKey("siap_cookie")
        val KULON_COOKIE = stringPreferencesKey("kulon_cookie")
    }

    val jwt: Flow<String?> = dataStore.data.map { decryptOrNull(it[Keys.JWT]) }
    override val siapCookie: Flow<String?> = dataStore.data.map { decryptOrNull(it[Keys.SIAP_COOKIE]) }
    override val kulonCookie: Flow<String?> = dataStore.data.map { decryptOrNull(it[Keys.KULON_COOKIE]) }

    /**
     * Encrypts and persists the token + optional cookies. A failure to encrypt
     * (throws) aborts the write — fail-closed, never persist plaintext.
     */
    override suspend fun save(token: String, siap: String?, kulon: String?) {
        dataStore.edit {
            it[Keys.JWT] = cipher.encrypt(token)
            if (siap != null) it[Keys.SIAP_COOKIE] = cipher.encrypt(siap)
            if (kulon != null) it[Keys.KULON_COOKIE] = cipher.encrypt(kulon)
        }
    }

    override suspend fun currentToken(): String? = jwt.first()

    override suspend fun clear() {
        dataStore.edit { it.clear() }
    }

    /** Returns null when the stored value is absent, tampered, wrong key or
     *  legacy plaintext — a clean, non-throwing "no valid session" signal. */
    private fun decryptOrNull(encoded: String?): String? =
        encoded?.let(cipher::decrypt)
}