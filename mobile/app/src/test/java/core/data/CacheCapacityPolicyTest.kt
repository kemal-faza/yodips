package ac.undip.sso.core.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CacheCapacityPolicyTest {
    @Test
    fun `an entry larger than 128 KB is rejected`() {
        assertFalse(CacheCapacityPolicy.shouldStore(CacheCapacityPolicy.MAX_ENTRY_BYTES + 1))
        assertTrue(CacheCapacityPolicy.shouldStore(CacheCapacityPolicy.MAX_ENTRY_BYTES))
    }

    @Test
    fun `trim is a no-op when total is under the cap`() {
        val entries = listOf(
            CacheEntryMeta("a", fetchedAt = 1, sizeBytes = 10),
            CacheEntryMeta("b", fetchedAt = 2, sizeBytes = 10),
        )
        assertEquals(emptySet<String>(), CacheCapacityPolicy.trim(entries, maxTotalBytes = 100))
    }

    @Test
    fun `trim deletes oldest until the total fits`() {
        val entries = listOf(
            CacheEntryMeta("newest", fetchedAt = 30, sizeBytes = 40),
            CacheEntryMeta("oldest", fetchedAt = 10, sizeBytes = 40),
            CacheEntryMeta("middle", fetchedAt = 20, sizeBytes = 40),
        )
        assertEquals(setOf("oldest", "middle"), CacheCapacityPolicy.trim(entries, maxTotalBytes = 50))
    }

    @Test
    fun `trim breaks ties by key for deterministic deletion`() {
        val entries = listOf(
            CacheEntryMeta("b", fetchedAt = 10, sizeBytes = 60),
            CacheEntryMeta("a", fetchedAt = 10, sizeBytes = 60),
        )
        assertEquals(setOf("a", "b"), CacheCapacityPolicy.trim(entries, maxTotalBytes = 50))
    }
}
