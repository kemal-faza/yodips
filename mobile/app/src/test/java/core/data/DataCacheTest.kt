package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.ErrorType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DataCacheTest {
    @Test
    fun `fresh get returns Fresh within ttl`() {
        val cache = InMemoryDataCache(ttlMs = 10_000)
        cache.put("k", ApiResult.Success("x"))
        val got = cache.get<String>("k", System.currentTimeMillis())
        assertTrue(got is DataCache.Cached.Fresh)
    }

    @Test
    fun `past ttl returns Stale but keeps data`() {
        val cache = InMemoryDataCache(ttlMs = 1_000)
        cache.put("k", ApiResult.Success("hello"))
        val future = System.currentTimeMillis() + 60_000
        val got = cache.get<String>("k", future)
        assertTrue(got is DataCache.Cached.Stale)
        val stale = got as DataCache.Cached.Stale<ApiResult<String>>
        assertEquals(ApiResult.Success("hello"), stale.data)
    }

    @Test
    fun `unknown key returns null`() {
        assertNull(InMemoryDataCache().get<String>("nope"))
    }

    @Test
    fun `errors are not cached`() {
        val cache = InMemoryDataCache(ttlMs = 10_000)
        cache.put("k", ApiResult.Error(500, "boom", ErrorType.SERVER))
        val got = cache.get<String>("k", System.currentTimeMillis())
        assertTrue(got is DataCache.Cached.Fresh)
    }
}
