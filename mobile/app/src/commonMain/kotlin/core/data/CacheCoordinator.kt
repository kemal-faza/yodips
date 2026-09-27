package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.nowMs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json

/** Oldest on-disk entry we will serve before falling back to the network. */
const val DEFAULT_DISK_MAX_AGE_MS = 12 * 60 * 60 * 1000L // 12h

/**
 * Two-tier cache policy, extracted from SsoRepository so cache behaviour is
 * testable without token plumbing:
 *  - in-memory [DataCache] (Fresh → instant; Stale → instant + background refresh),
 *  - on-disk [PersistentCache] restored on a cold memory miss so a screen still
 *    opens instantly after a process restart / app relaunch.
 *
 * A lifecycle generation makes explicit logout authoritative: foreground and
 * background fetches from the old session cannot repopulate either cache after
 * the wipe, and background refresh flights are cancelled and released.
 */
class CacheCoordinator(
    private val cache: DataCache,
    private val persistent: PersistentCache,
    private val diskMaxAgeMs: Long = DEFAULT_DISK_MAX_AGE_MS,
    private val scope: CoroutineScope,
) {
    private data class RefreshKey(val key: String, val generation: Long)

    private data class RefreshRun(
        val key: RefreshKey,
        val claim: SessionFlight.Claim<Unit>,
        val job: Job,
    )

    private val json = Json { ignoreUnknownKeys = true }
    private val refreshFlight = SessionFlight<Unit>()
    private val lifecycleMutex = Mutex()
    private var generation = 0L
    private val refreshJobs = mutableMapOf<RefreshKey, RefreshRun>()

    suspend fun <T> cached(
        key: String,
        serializer: KSerializer<T>,
        force: Boolean,
        block: suspend () -> ApiResult<T>,
    ): ApiResult<T> {
        val requestGeneration = lifecycleMutex.withLock { generation }
        if (force) {
            val fresh = block()
            commitIfCurrent(requestGeneration, key, serializer, fresh)
            return fresh
        }
        when (val prev = cache.get<T>(key)) {
            is DataCache.Cached.Fresh -> return prev.data

            is DataCache.Cached.Stale -> {
                refreshBackground(key, serializer, requestGeneration, block)
                return prev.data
            }

            null -> {
                restoreFromDisk(key, serializer, requestGeneration)?.let { fromDisk ->
                    refreshBackground(key, serializer, requestGeneration, block)
                    return fromDisk
                }
                val fresh = block()
                commitIfCurrent(requestGeneration, key, serializer, fresh)
                return fresh
            }
        }
    }

    /** Clear all user-scoped values and prevent old work from writing them back. */
    suspend fun clear() {
        val active = lifecycleMutex.withLock {
            generation += 1
            val runs = refreshJobs.values.toList()
            refreshJobs.clear()
            runs.forEach { it.job.cancel() }
            cache.clear()
            persistent.clear()
            runs
        }
        active.map { it.job }.joinAll()
        // Jobs cancelled before their lazy body starts have no finally block.
        active.forEach { refreshFlight.release(it.claim, Unit) }
    }

    /** Restore a fresh-enough disk payload without crossing a logout boundary. */
    private suspend fun <T> restoreFromDisk(
        key: String,
        serializer: KSerializer<T>,
        requestGeneration: Long,
    ): ApiResult<T>? {
        val entry = runCatching { persistent.load(key) }.getOrNull() ?: return null
        if (nowMs() - entry.fetchedAt > diskMaxAgeMs) return null
        val value = runCatching { json.decodeFromString(serializer, entry.json) }.getOrNull() ?: return null
        val result = ApiResult.Success(value)
        var restored = false
        lifecycleMutex.withLock {
            if (generation == requestGeneration) {
                cache.put(key, result)
                restored = true
            }
        }
        return if (restored) result else null
    }

    private suspend fun <T> refreshBackground(
        key: String,
        serializer: KSerializer<T>,
        requestGeneration: Long,
        block: suspend () -> ApiResult<T>,
    ) {
        val claim = refreshFlight.claimOrNull(key, requestGeneration) ?: return
        val refreshKey = RefreshKey(key, requestGeneration)
        val job = scope.launch(start = CoroutineStart.LAZY) {
            val currentJob = currentCoroutineContext()[Job]
            try {
                val fresh = block()
                commitIfCurrent(requestGeneration, key, serializer, fresh)
            } finally {
                refreshFlight.release(claim, Unit)
                withContext(NonCancellable) {
                    lifecycleMutex.withLock {
                        if (refreshJobs[refreshKey]?.job === currentJob) refreshJobs.remove(refreshKey)
                    }
                }
            }
        }
        val run = RefreshRun(refreshKey, claim, job)
        withContext(NonCancellable) {
            lifecycleMutex.withLock {
                if (generation == requestGeneration) {
                    refreshJobs[refreshKey] = run
                    job.start()
                } else {
                    job.cancel()
                    refreshFlight.release(claim, Unit)
                }
            }
        }
    }

    private suspend fun <T> commitIfCurrent(
        requestGeneration: Long,
        key: String,
        serializer: KSerializer<T>,
        result: ApiResult<T>,
    ) {
        if (result !is ApiResult.Success) return
        lifecycleMutex.withLock {
            if (generation != requestGeneration) return@withLock
            cache.put(key, result)
            val payload = runCatching { json.encodeToString(serializer, result.data) }.getOrNull() ?: return@withLock
            // Serialize the disk write with clear(): either it finishes before
            // the wipe, or observes the newer generation and skips the write.
            scope.launch {
                lifecycleMutex.withLock {
                    if (generation == requestGeneration) {
                        runCatching { persistent.save(key, payload, nowMs()) }
                    }
                }
            }
        }
    }
}
