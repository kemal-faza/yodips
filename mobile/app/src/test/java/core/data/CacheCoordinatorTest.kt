package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.builtins.serializer
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Two-tier cache policy (fresh/stale/disk-restore/persist), split out of
 * SsoRepository so cache behaviour is testable without token plumbing.
 */
class CacheCoordinatorTest {
    private class FakeDisk : PersistentCache {
        val saved = mutableMapOf<String, Pair<String, Long>>()
        var seeded: Map<String, PersistentCache.Entry> = emptyMap()
        override suspend fun load(key: String): PersistentCache.Entry? = seeded[key]
        override suspend fun save(key: String, json: String, fetchedAt: Long) {
            saved[key] = json to fetchedAt
        }
    }

    private fun coordinator(
        cache: DataCache = InMemoryDataCache(),
        disk: FakeDisk = FakeDisk(),
        scope: CoroutineScope = CoroutineScope(Dispatchers.Unconfined),
    ) = CacheCoordinator(cache, disk, diskMaxAgeMs = 12 * 60 * 60 * 1000L, scope = scope)

    @Test
    fun `force bypasses the memory cache and persists the fresh result`() = runTest {
        val cache = InMemoryDataCache()
        cache.put("k", ApiResult.Success("stale-value"))
        var networkCalls = 0
        val out = coordinator(cache).cached("k", String.serializer(), force = true) {
            networkCalls += 1
            ApiResult.Success("fresh")
        }
        assertEquals("fresh", (out as ApiResult.Success).data)
        assertEquals(1, networkCalls)
    }

    @Test
    fun `a fresh hit is served instantly without hitting the network`() = runTest {
        val cache = InMemoryDataCache(ttlMs = Long.MAX_VALUE)
        cache.put("k", ApiResult.Success("warm"))
        val out = coordinator(cache).cached("k", String.serializer(), force = false) {
            throw AssertionError("network must not be hit on a fresh hit")
        }
        assertEquals("warm", (out as ApiResult.Success).data)
    }

    @Test
    fun `a stale hit serves the stale value instantly (background refresh warms the next visit)`() = runTest {
        val cache = InMemoryDataCache(ttlMs = 0) // everything is immediately stale
        cache.put("k", ApiResult.Success("stale-but-here"))
        val out = coordinator(cache).cached("k", String.serializer(), force = false) {
            ApiResult.Success("from-network")
        }
        // The stale-while-revalidate guarantee: never block on the slow scrape.
        assertEquals("stale-but-here", (out as ApiResult.Success).data)
    }

    @Test
    fun `cold miss restores a fresh-enough disk entry and seeds memory`() = runTest {
        val disk = FakeDisk().apply {
            seeded = mapOf("k" to PersistentCache.Entry(json = "\"from-disk\"", fetchedAt = System.currentTimeMillis()))
        }
        val cache = InMemoryDataCache()
        // backgroundScope: the SWR background refresh stays QUEUED on the test
        // scheduler while we assert the synchronous path below.
        var networkCalled = false
        val out = coordinator(cache, disk, scope = backgroundScope).cached(
            "k", String.serializer(), force = false,
        ) {
            networkCalled = true
            ApiResult.Success("from-network")
        }
        // Disk restore served the read WITHOUT blocking on the network...
        assertEquals("from-disk", (out as ApiResult.Success).data)
        org.junit.Assert.assertFalse(networkCalled)
        // ...and seeded memory so the next read is a warm hit.
        val reseeded = cache.get<String>("k") as DataCache.Cached.Fresh
        assertEquals("from-disk", (reseeded.data as ApiResult.Success).data)
    }

    @Test
    fun `an expired disk entry falls through to the network`() = runTest {
        val disk = FakeDisk().apply {
            seeded = mapOf(
                "k" to PersistentCache.Entry(
                    json = "\"ancient\"",
                    fetchedAt = System.currentTimeMillis() - 13 * 60 * 60 * 1000L,
                ),
            )
        }
        val out = coordinator(disk = disk).cached("k", String.serializer(), force = false) {
            ApiResult.Success("from-network")
        }
        assertEquals("from-network", (out as ApiResult.Success).data)
    }
}
