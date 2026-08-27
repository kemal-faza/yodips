package ac.undip.sso.core.push

import kotlinx.serialization.Serializable

/**
 * Satu notifikasi push yang pernah diterima perangkat — disimpan LOKAL supaya
 * user bisa membuka kembali notifikasi yang hanya tampil sesaat di status bar.
 */
@Serializable
data class StoredNotification(
    /** Dedup key: <title+body> hash (from the PushMessagingService requestCode). */
    val id: String = "",
    val title: String = "",
    val body: String = "",
    /** Push target tab ("tasks" / "schedule" / "") — dipakai untuk navigasi tap. */
    val target: String = "",
    val payload: String = "",
    val receivedAt: Long = 0,
)

/** On-device storage for received-push history (pure interface for testability). */
interface NotificationHistoryStore {
    suspend fun append(notification: StoredNotification)
    suspend fun all(): List<StoredNotification>
    suspend fun clear()
}

/** Maksimal jumlah notifikasi yang disimpan agar DataStore tidak membengkak. */
internal const val NOTIFICATION_HISTORY_LIMIT = 100

/** Build a dedup id from title+body (mirror of the status-bar requestCode). */
internal fun notificationId(title: String, body: String): String =
    (title + "|" + body).hashCode().toString()

/**
 * Pure history-merge policy: prepend the newest notification, drop an existing
 * entry with the same id (so a repeat push just refreshes its timestamp), and
 * clamp to [NOTIFICATION_HISTORY_LIMIT] newest. Kept pure so the store
 * implementations only do JSON read/write.
 */
internal fun mergeNotification(
    existing: List<StoredNotification>,
    notification: StoredNotification,
): List<StoredNotification> {
    val updated = notification.copy(id = notification.id.ifBlank { notificationId(notification.title, notification.body) })
    val withoutDuplicate = existing.filterNot { it.id == updated.id }
    return (listOf(updated) + withoutDuplicate).take(NOTIFICATION_HISTORY_LIMIT)
}
