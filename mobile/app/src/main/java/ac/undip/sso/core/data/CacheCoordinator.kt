package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import java.util.concurrent.ConcurrentHashMap

/** Oldest on-disk entry we will serve before falling back to the network. */
const val DEFAULT_DISK_MAX_AGE_MS = 12 * 60 * 60 * 1000L // 12h

/**
 * Two-tier cache policy, extracted from SsoRepository so cache behaviour is
 * testable without token plumbing:
 *  - in-memory [DataCache] (Fresh → instant; Stale → instant + background refresh),
 *  - on-disk [PersistentCache] restored on a cold memory miss so a screen still
 *    opens instantly after a process restart, and written back whenever a fresh
 *    result arrives.
 *
 * A background refresh is skipped if one is already in flight for the key,
 * and its result is written back to memory + disk only on success.
 */
class CacheCoordinator(
    private val cache: DataCache,
    private val persistent: PersistentCache,
    private val diskMaxAgeMs: Long = DEFAULT_DISK_MAX_AGE_MS,
    private val scope: CoroutineScope,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val refreshing = ConcurrentHashMap.newKeySet<String>()

    /**
     * Fresh cache → serve instantly, never hitting the network.
     * Stale cache → serve the stale value instantly AND re-fetch in the
     * background to warm the cache for the next visit (no visible spinner).
     * Cold cache → try the on-disk cache first (no spinner after a relaunch),
     * and only block on the network if the disk is also empty/too old.
     */
    suspend fun <T> cached(
        key: String,
        serializer: KSerializer<T>,
        force: Boolean,
        block: suspend () -> ApiResult<T>,
    ): ApiResult<T> {
        // Pull-to-refresh: bypass the cache and re-fetch from the network now.
        if (force) {
            val fresh = block()
            if (fresh is ApiResult.Success) {
                cache.put(key, fresh)
                persist(key, serializer, fresh)
            }
            return fresh
        }
        when (val prev = cache.get<T>(key)) {
            is DataCache.Cached.Fresh -> return prev.data

            is DataCache.Cached.Stale -> {
                refreshBackground(key, serializer, block)
                return prev.data
            }

            null -> {
                restoreFromDisk(key, serializer)?.let { fromDisk ->
                    refreshBackground(key, serializer, block)
                    return fromDisk
                }
                val fresh = block()
                if (fresh is ApiResult.Success) {
                    cache.put(key, fresh)
                    persist(key, serializer, fresh)
                }
                return fresh
            }
        }
    }

    /** Serve a fresh-enough on-disk payload, seeding the in-memory cache with it. */
    private suspend fun <T> restoreFromDisk(
        key: String,
        serializer: KSerializer<T>,
    ): ApiResult<T>? {
        val entry = runCatching { persistent.load(key) }.getOrNull() ?: return null
        if (System.currentTimeMillis() - entry.fetchedAt > diskMaxAgeMs) return null
        return runCatching {
            val value = json.decodeFromString(serializer, entry.json)
            cache.put(key, ApiResult.Success(value))
            ApiResult.Success(value)
        }.getOrNull()
    }

    private fun <T> refreshBackground(
        key: String,
        serializer: KSerializer<T>,
        block: suspend () -> ApiResult<T>,
    ) {
        if (!refreshing.add(key)) return
        scope.launch {
            try {
                val fresh = block()
                if (fresh is ApiResult.Success) {
                    cache.put(key, fresh)
                    persist(key, serializer, fresh)
                }
            } finally {
                refreshing.remove(key)
            }
        }
    }

    /** Fire-and-forget write of a successful payload to disk. */
    fun <T> persist(
        key: String,
        serializer: KSerializer<T>,
        result: ApiResult<T>,
    ) {
        val value = (result as? ApiResult.Success)?.data ?: return
        val payload = runCatching { json.encodeToString(serializer, value) }.getOrNull() ?: return
        scope.launch {
            runCatching { persistent.save(key, payload, System.currentTimeMillis()) }
        }
    }
}
