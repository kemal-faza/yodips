package ac.undip.sso.core.session

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "sso_session")

/**
 * Persist the JWT (and the raw per-source session cookies captured during
 * handoff) in jetpack DataStore. For a production app the JWT should live in
 * encrypted storage (EncryptedSharedPreferences/Keystore); plain DataStore is
 * acceptable for the C1 scaffold and flagged as a hardening TODO.
 */
class TokenStore(private val context: Context) {
    private object Keys {
        val JWT = stringPreferencesKey("jwt")
        val SIAP_COOKIE = stringPreferencesKey("siap_cookie")
        val KULON_COOKIE = stringPreferencesKey("kulon_cookie")
    }

    val jwt: Flow<String?> = context.dataStore.data.map { it[Keys.JWT] }
    val siapCookie: Flow<String?> = context.dataStore.data.map { it[Keys.SIAP_COOKIE] }
    val kulonCookie: Flow<String?> = context.dataStore.data.map { it[Keys.KULON_COOKIE] }

    suspend fun save(token: String, siap: String?, kulon: String?) {
        context.dataStore.edit {
            it[Keys.JWT] = token
            if (siap != null) it[Keys.SIAP_COOKIE] = siap
            if (kulon != null) it[Keys.KULON_COOKIE] = kulon
        }
    }

    suspend fun currentToken(): String? = jwt.first()

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }
}
