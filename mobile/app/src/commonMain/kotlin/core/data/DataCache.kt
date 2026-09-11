package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.nowMs
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Size of a fetched value is not re-read from the wire logic — this cache only
 * remembers repo results so tab revisits (which re-run each screen's
 * `LoadableData`) don't re-hit the slow backend scrape. A fresh hit returns
 * instantly; a stale hit triggers a background refresh but still serves stale
 * data if the network fails (resilience over an empty spinner).
 *
 * Access is suspend-based so [InMemoryDataCache] can use a kotlinx [Mutex]
 * instead of the old wasm-no-op `platformSynchronized` (ADR-0003).
 */
interface DataCache {
    /** Fresh = returned with ttl; Stale = data is older than ttl (still usable). */
    suspend fun <T> get(
        key: String,
        now: Long = nowMs(),
    ): Cached<ApiResult<T>>?

    suspend fun <T> put(
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

/** Thread-safe in-memory TTL cache. Pure Kotlin — no JVM deps, unit-testable. */
class InMemoryDataCache(
    private val ttlMs: Long = DEFAULT_CACHE_TTL_MS,
) : DataCache {
    private class Entry(
        val value: ApiResult<*>,
        val fetchedAt: Long,
    )

    private val mutex = Mutex()
    private val store = mutableMapOf<String, Entry>()

    override suspend fun <T> get(
        key: String,
        now: Long,
    ): DataCache.Cached<ApiResult<T>>? =
        mutex.withLock {
            val e = store[key]
            if (e == null) {
                null
            } else {
                @Suppress("UNCHECKED_CAST")
                val value = e.value as ApiResult<T>
                if (now - e.fetchedAt <= ttlMs) {
                    DataCache.Cached.Fresh(value)
                } else {
                    DataCache.Cached.Stale(value)
                }
            }
        }

    override suspend fun <T> put(
        key: String,
        value: ApiResult<T>,
    ) {
        mutex.withLock {
            store[key] = Entry(value, nowMs())
        }
    }
}
