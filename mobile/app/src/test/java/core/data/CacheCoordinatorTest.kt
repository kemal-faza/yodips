package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.ErrorType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runCurrent
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
    fun `an error result is never cached in memory or on disk`() = runTest {
        val cache = InMemoryDataCache()
        val disk = FakeDisk()
        val out = coordinator(cache, disk).cached("k", String.serializer(), force = true) {
            ApiResult.Error(500, "boom", ErrorType.SERVER)
        }
        assertEquals("boom", (out as ApiResult.Error).message)
        assertEquals(0, disk.saved.size)
        org.junit.Assert.assertNull(cache.get<String>("k"))
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

    @Test
    fun `duplicate stale background refreshes for a key collapse into one network call`() = runTest {
        // Candidate #6: the shared SessionFlight claims the key for the first
        // refresh and SKIPS the duplicate, so N stale reads schedule one POST.
        // ttl < 0 (not 0) so every entry is DETERMINISTICALLY stale: with ttl 0
        // a put/get in the same millisecond reports Fresh and no refresh runs.
        val cache = InMemoryDataCache(ttlMs = -1)
        cache.put("k", ApiResult.Success("stale-but-here"))
        var networkCalls = 0
        val coordinator = coordinator(cache, scope = backgroundScope)
        coordinator.cached("k", String.serializer(), force = false) {
            networkCalls += 1
            delay(100)
            ApiResult.Success("fresh")
        }
        coordinator.cached("k", String.serializer(), force = false) {
            networkCalls += 1
            delay(100)
            ApiResult.Success("fresh")
        }
        // backgroundScope work is NOT drained by advanceUntilIdle in kotlinx
        // 1.10 (it stops once no FOREGROUND events remain); runCurrent executes
        // the one refresh that was scheduled, up to its first suspension. Both
        // reads are issued before this, so the second is the one that must skip.
        runCurrent()
        assertEquals("duplicate background refresh must be skipped", 1, networkCalls)
    }

    @Test
    fun `stale hit publishes the cached value first, then the refreshed value`() = runTest {
        val cache = InMemoryDataCache(ttlMs = -1)
        cache.put("k", ApiResult.Success("stale-but-here"))
        val published = mutableListOf<ApiResult<String>>()
        coordinator(cache, scope = backgroundScope).cached(
            "k", String.serializer(), force = false,
            onValue = { published += it },
        ) {
            ApiResult.Success("fresh")
        }
        // The immediate (cache) value is observable before the refresh resolves.
        assertEquals(listOf<ApiResult<String>>(ApiResult.Success("stale-but-here")), published)
        runCurrent()
        assertEquals(
            listOf(ApiResult.Success("stale-but-here"), ApiResult.Success("fresh")),
            published,
        )
    }

    @Test
    fun `a failed background refresh keeps the last published value`() = runTest {
        val cache = InMemoryDataCache(ttlMs = -1)
        cache.put("k", ApiResult.Success("stale-but-here"))
        val published = mutableListOf<ApiResult<String>>()
        coordinator(cache, scope = backgroundScope).cached(
            "k", String.serializer(), force = false,
            onValue = { published += it },
        ) {
            ApiResult.Error(500, "boom", ErrorType.SERVER)
        }
        runCurrent()
        // No error event: the screen keeps showing the value it already had.
        assertEquals(listOf<ApiResult<String>>(ApiResult.Success("stale-but-here")), published)
    }

    @Test
    fun `force publishes an error so an explicit pull can surface the failure`() = runTest {
        val published = mutableListOf<ApiResult<String>>()
        val error = ApiResult.Error(500, "boom", ErrorType.SERVER)
        coordinator().cached(
            "k", String.serializer(), force = true,
            onValue = { published += it },
        ) { error }
        assertEquals(listOf(error), published)
    }

    @Test
    fun `revalidate false serves stale without scheduling a network refresh`() = runTest {
        val cache = InMemoryDataCache(ttlMs = -1)
        cache.put("k", ApiResult.Success("stale-but-here"))
        var networkCalls = 0
        val published = mutableListOf<ApiResult<String>>()
        val out = coordinator(cache, scope = backgroundScope).cached(
            "k", String.serializer(), force = false, revalidate = false,
            onValue = { published += it },
        ) {
            networkCalls += 1
            ApiResult.Success("fresh")
        }
        runCurrent()
        assertEquals("stale-but-here", (out as ApiResult.Success).data)
        assertEquals("rare data must not refresh on entry", 0, networkCalls)
        assertEquals(listOf<ApiResult<String>>(ApiResult.Success("stale-but-here")), published)
    }

    @Test
    fun `revalidate false still fetches on a cold miss`() = runTest {
        var networkCalls = 0
        val out = coordinator().cached("k", String.serializer(), force = false, revalidate = false) {
            networkCalls += 1
            ApiResult.Success("from-network")
        }
        assertEquals("from-network", (out as ApiResult.Success).data)
        assertEquals(1, networkCalls)
    }

    @Test
    fun `revalidate false restores a disk entry without scheduling a refresh`() = runTest {
        val disk = FakeDisk().apply {
            seeded = mapOf("k" to PersistentCache.Entry(json = "\"from-disk\"", fetchedAt = System.currentTimeMillis()))
        }
        var networkCalled = false
        val out = coordinator(disk = disk, scope = backgroundScope).cached(
            "k", String.serializer(), force = false, revalidate = false,
        ) {
            networkCalled = true
            ApiResult.Success("from-network")
        }
        runCurrent()
        assertEquals("from-disk", (out as ApiResult.Success).data)
        org.junit.Assert.assertFalse(networkCalled)
    }
}
