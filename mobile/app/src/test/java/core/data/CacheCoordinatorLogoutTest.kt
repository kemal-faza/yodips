package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.SiapProfile
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CacheCoordinatorLogoutTest {
    private class MemoryDisk : PersistentCache {
        val values = mutableMapOf<String, PersistentCache.Entry>()

        override suspend fun load(key: String): PersistentCache.Entry? = values[key]

        override suspend fun save(key: String, json: String, fetchedAt: Long) {
            values[key] = PersistentCache.Entry(json, fetchedAt)
        }

        override suspend fun clear() {
            values.clear()
        }
    }

    @Test
    fun `logout clears both caches and old foreground work cannot repopulate them`() = runTest {
        val memory = InMemoryDataCache()
        val disk = MemoryDisk()
        val coordinator = CacheCoordinator(memory, disk, scope = backgroundScope)
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<ApiResult<SiapProfile>>()
        val oldResult = ApiResult.Success(SiapProfile(nama = "old", nim = "old"))

        val oldRequest = async {
            coordinator.cached("profile", SiapProfile.serializer(), force = true) {
                started.complete(Unit)
                release.await()
            }
        }
        started.await()
        coordinator.clear()
        release.complete(oldResult)

        assertEquals(oldResult, oldRequest.await())
        assertNull(memory.get<SiapProfile>("profile"))
        assertNull(disk.load("profile"))

        val freshResult = ApiResult.Success(SiapProfile(nama = "new", nim = "new"))
        var networkCalls = 0
        assertEquals(
            freshResult,
            coordinator.cached("profile", SiapProfile.serializer(), force = false) {
                networkCalls++
                freshResult
            },
        )
        runCurrent()

        assertEquals(1, networkCalls)
        assertEquals(freshResult, memory.get<SiapProfile>("profile")?.let {
            (it as DataCache.Cached.Fresh).data
        })
        assertEquals(true, disk.load("profile") != null)
    }
}
