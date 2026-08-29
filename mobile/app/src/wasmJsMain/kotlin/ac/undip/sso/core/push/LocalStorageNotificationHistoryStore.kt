package ac.undip.sso.core.push

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * localStorage-backed [NotificationHistoryStore] (PWA / wasmJs).
 *
 * Key `sso_notif_history` dibagi DENGAN service worker: SW menulis daftar
 * notifikasi baru (plain JSON array) saat push diterima, dan PWA membacanya
 * kembali saat layar Notifikasi dibuka. Keduanya menulis array
 * `StoredNotification` dengan field yang sama, jadi satu serializer cocok
 * untuk kedua format. Non-PII (title/body/target) — plaintext, konsisten
 * dengan kebijakan FCM-token di PushGraph.
 */
class LocalStorageNotificationHistoryStore : NotificationHistoryStore {
    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
    }
    private val serializer = ListSerializer(StoredNotification.serializer())

    override suspend fun append(notification: StoredNotification) {
        val merged = mergeNotification(all(), notification)
        jsLocalStorageSetItem(HISTORY_KEY, json.encodeToString(serializer, merged))
    }

    override suspend fun all(): List<StoredNotification> {
        val raw = jsLocalStorageGetItem(HISTORY_KEY) ?: return emptyList()
        return runCatching { json.decodeFromString(serializer, raw) }.getOrDefault(emptyList())
    }

    override suspend fun clear() {
        jsLocalStorageRemoveItem(HISTORY_KEY)
    }

    private companion object {
        /** Sama dengan key yang dipakai service worker (pwa-app-core.mjs). */
        const val HISTORY_KEY = "sso_notif_history"
    }
}

@JsFun("(key) => localStorage.getItem(key)")
private external fun jsLocalStorageGetItem(key: String): String?

@JsFun("(key, value) => localStorage.setItem(key, value)")
private external fun jsLocalStorageSetItem(key: String, value: String)

@JsFun("(key) => localStorage.removeItem(key)")
private external fun jsLocalStorageRemoveItem(key: String)
