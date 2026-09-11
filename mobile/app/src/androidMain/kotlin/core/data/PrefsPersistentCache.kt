package ac.undip.sso.core.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first

private val Context.cacheDataStore by preferencesDataStore(name = "sso_data_cache")

/** DataStore-backed [PersistentCache]: per key it stores `$key.json` + `$key.time`. */
class PrefsPersistentCache(
    private val context: Context,
) : PersistentCache {
    private fun jsonKey(key: String) = "$key.json"

    private fun timeKey(key: String) = "$key.time"

    override suspend fun load(key: String): PersistentCache.Entry? {
        val prefs = context.cacheDataStore.data.first()
        val json = prefs[stringPreferencesKey(jsonKey(key))] ?: return null
        val time = prefs[longPreferencesKey(timeKey(key))] ?: return null
        return PersistentCache.Entry(json, time)
    }

    override suspend fun save(
        key: String,
        json: String,
        fetchedAt: Long,
    ) {
        context.cacheDataStore.edit {
            it[stringPreferencesKey(jsonKey(key))] = json
            it[longPreferencesKey(timeKey(key))] = fetchedAt
        }
    }
}
