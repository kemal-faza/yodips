package ac.undip.sso.core.push

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.first

private val PENDING_TOKEN_KEY = stringPreferencesKey("pending_fcm_token")

/** Production DataStore seam for durable pending-token ownership. */
internal class PendingPushTokenStore(
    private val dataStore: DataStore<Preferences>,
) {
    suspend fun stash(token: String) {
        dataStore.edit { it[PENDING_TOKEN_KEY] = token }
    }

    suspend fun read(): String? = dataStore.data.first()[PENDING_TOKEN_KEY]

    /** Atomically removes the value only when it is still [expectedToken]. */
    suspend fun clearIfMatches(expectedToken: String) {
        dataStore.edit {
            if (it[PENDING_TOKEN_KEY] == expectedToken) it.remove(PENDING_TOKEN_KEY)
        }
    }
}
