package ac.undip.sso.core.push

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

private val Context.notifHistoryDataStore by preferencesDataStore(name = "sso_notif_history")
private val HISTORY_KEY = stringPreferencesKey("received")

/**
 * DataStore-backed [NotificationHistoryStore]. Serializes the list to one
 * string per write; reads decode (or fall back to empty on a corrupt/legacy
 * value). Non-PII (title/body/target) — not encrypted, mirroring the FCM-token
 * plaintext policy in PushGraph.
 */
class DataStoreNotificationHistoryStore(
    private val context: Context,
) : NotificationHistoryStore {
    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
    }
    private val serializer = ListSerializer(StoredNotification.serializer())

    override suspend fun append(notification: StoredNotification) {
        val current = all()
        val merged = mergeNotification(current, notification)
        context.notifHistoryDataStore.edit { it[HISTORY_KEY] = json.encodeToString(serializer, merged) }
    }

    override suspend fun all(): List<StoredNotification> {
        val raw = context.notifHistoryDataStore.data.first()[HISTORY_KEY] ?: return emptyList()
        return runCatching { json.decodeFromString(serializer, raw) }.getOrDefault(emptyList())
    }

    override suspend fun clear() {
        context.notifHistoryDataStore.edit { it.remove(HISTORY_KEY) }
    }
}
