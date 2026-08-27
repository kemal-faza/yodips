package ac.undip.sso.core.push

import org.junit.Assert.assertEquals
import org.junit.Test

class NotificationHistoryTest {
    @Test
    fun `merge prepends newest and dedups by id`() {
        val a = StoredNotification(id = "1", title = "A", body = "x", receivedAt = 100)
        val b = StoredNotification(id = "2", title = "B", body = "y", receivedAt = 200)
        val merged = mergeNotification(listOf(a, b), StoredNotification(id = "1", title = "A2", body = "x2", receivedAt = 300))
        assertEquals(2, merged.size)
        assertEquals("1", merged[0].id) // refresh position + content
        assertEquals("A2", merged[0].title)
        assertEquals("2", merged[1].id)
    }

    @Test
    fun `blank id is derived from title and body`() {
        val merged = mergeNotification(emptyList(), StoredNotification(title = "Tugas baru", body = "due 07 Mei"))
        assertEquals(1, merged.size)
        assertEquals(notificationId("Tugas baru", "due 07 Mei"), merged[0].id)
    }

    @Test
    fun `history is clamped to limit`() {
        val many = (1..150).map { StoredNotification(id = it.toString(), title = "T$it") }
        val merged = mergeNotification(many, StoredNotification(id = "new", title = "New"))
        assertEquals(NOTIFICATION_HISTORY_LIMIT, merged.size)
        assertEquals("new", merged[0].id)
    }

    @Test
    fun `merge with no duplicate in a full list keeps newest`() {
        val many = (1..100).map { StoredNotification(id = it.toString(), title = "T$it") }
        val merged = mergeNotification(many, StoredNotification(id = "999", title = "Fresh"))
        assertEquals(100, merged.size)
        assertEquals("999", merged[0].id)
        assertEquals("1", merged[1].id)
        assertEquals("99", merged.last().id)
    }
}
