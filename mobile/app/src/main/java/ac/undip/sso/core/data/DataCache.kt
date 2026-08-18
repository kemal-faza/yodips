package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiResult
import java.util.concurrent.ConcurrentHashMap

/**
 * Size of a fetched value is not re-read from the wire logic — this cache only
 * remembers repo results so tab revisits (which re-run each screen's
 * `LoadableData`) don't re-hit the slow backend scrape. A fresh hit returns
 * instantly; a stale hit triggers a background refresh but still serves stale
 * data if the network fails (resilience over an empty spinner).
 */
interface DataCache {
    /** Fresh = returned with ttl; Stale = data is older than ttl (still usable). */
    fun <T> get(
        key: String,
        now: Long = System.currentTimeMillis(),
    ): Cached<ApiResult<T>>?

    fun <T> put(
        key: String,
        value: ApiResult<T>,
    )

    sealed interface Cached<out T> {
        data class Fresh<T>(
            val data: T,
        ) : Cached<T>

        data class Stale<T>(
            val data: T,
        ) : Cached<T>
    }
}

const val DEFAULT_CACHE_TTL_MS = 2 * 60_000L

/** Thread-safe in-memory TTL cache. Pure JVM — no Android deps, unit-testable. */
class InMemoryDataCache(
    private val ttlMs: Long = DEFAULT_CACHE_TTL_MS,
) : DataCache {
    private class Entry(
        val value: ApiResult<*>,
        val fetchedAt: Long,
    )

    private val store = ConcurrentHashMap<String, Entry>()

    override fun <T> get(
        key: String,
        now: Long,
    ): DataCache.Cached<ApiResult<T>>? {
        val e = store[key] ?: return null

        @Suppress("UNCHECKED_CAST")
        val value = e.value as ApiResult<T>
        return if (now - e.fetchedAt <= ttlMs) {
            DataCache.Cached.Fresh(value)
        } else {
            DataCache.Cached.Stale(value)
        }
    }

    override fun <T> put(
        key: String,
        value: ApiResult<T>,
    ) {
        store[key] = Entry(value, System.currentTimeMillis())
    }
}
