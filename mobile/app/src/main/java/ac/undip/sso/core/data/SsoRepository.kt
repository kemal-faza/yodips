package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiClient
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.ErrorType
import ac.undip.sso.core.network.KehadiranRequest
import ac.undip.sso.core.network.KehadiranResponse
import ac.undip.sso.core.network.KulonAssignment
import ac.undip.sso.core.network.KulonCourse
import ac.undip.sso.core.network.SiapAbsen
import ac.undip.sso.core.network.SiapIrs
import ac.undip.sso.core.network.SiapJadwal
import ac.undip.sso.core.network.SiapKhs
import ac.undip.sso.core.network.SiapLecturer
import ac.undip.sso.core.network.SiapProfile
import ac.undip.sso.core.network.SessionExpiredEvents
import ac.undip.sso.core.network.SsoApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

/** Oldest on-disk entry we will serve before falling back to the network. */
private const val DEFAULT_DISK_MAX_AGE_MS = 12 * 60 * 60 * 1000L // 12h

/**
 * Repository: maps every Retrofit call into [ApiResult] with a coarse error
 * taxonomy (see [ErrorType]). Screens clamp to Loading/Empty/Error/Content.
 * A [retrofit2.HttpException] 401 is surfaced as [ErrorType.UNAUTHORIZED] so
 * the app can trigger a re-login; network/parse failures map to NETWORK/SERVER.
 *
 * Caching is two-tier:
 *  - in-memory [DataCache] (Fresh → instant; Stale → instant + background refresh),
 *  - on-disk [PersistentCache] (DataStore) restored on a cold memory miss so the
 *    screen still opens instantly after a process restart / app relaunch, and
 *    written back whenever a fresh result arrives.
 *
 * Every 401 (expired JWT or backend lost the upstream session) additionally
 * fires [onSessionExpired] — wired to [SessionExpiredEvents] so AppRoot can show
 * a universal re-login dialog. This also catches 401s from background refreshes
 * which the UI never surfaces, killing the "stale cache keeps showing while the
 * session is dead" trap.
 */
class SsoRepository(
    private val api: SsoApi = ApiClient.api,
    private val cache: DataCache = InMemoryDataCache(),
    private val persistent: PersistentCache = NoOpPersistentCache,
    private val diskMaxAgeMs: Long = DEFAULT_DISK_MAX_AGE_MS,
    private val onSessionExpired: () -> Unit = SessionExpiredEvents::notifySessionExpired,
) {
    // Stale-while-revalidate: stale data is served instantly and re-fetched in
    // the background so a tab revisit never blocks on the slow backend scrape.
    private val refreshScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val refreshing = ConcurrentHashMap.newKeySet<String>()

    private val json = Json { ignoreUnknownKeys = true }

    suspend fun profile(force: Boolean = false): ApiResult<SiapProfile> =
        cached("profile", SiapProfile.serializer(), force) {
            safe { api.profile() }
        }

    suspend fun irs(force: Boolean = false): ApiResult<SiapIrs> =
        cached("irs", SiapIrs.serializer(), force) {
            safe { api.irs() }
        }

    suspend fun khs(force: Boolean = false): ApiResult<SiapKhs> =
        cached("khs", SiapKhs.serializer(), force) {
            safe { api.khs() }
        }

    suspend fun jadwal(force: Boolean = false): ApiResult<List<SiapJadwal>> =
        cached("jadwal", ListSerializer(SiapJadwal.serializer()), force) {
            safe { api.jadwal() }
        }

    suspend fun assignments(force: Boolean = false): ApiResult<List<KulonAssignment>> =
        cached("assignments", ListSerializer(KulonAssignment.serializer()), force) {
            safe { api.assignments() }
        }

    suspend fun courses(force: Boolean = false): ApiResult<List<KulonCourse>> =
        cached("courses", ListSerializer(KulonCourse.serializer()), force) {
            safe { api.courses() }
        }

    suspend fun lecturers(force: Boolean = false): ApiResult<List<SiapLecturer>> =
        cached("lecturers", ListSerializer(SiapLecturer.serializer()), force) {
            safe { api.lecturers() }
        }

    suspend fun absen(force: Boolean = false): ApiResult<List<SiapAbsen>> =
        cached("absen", ListSerializer(SiapAbsen.serializer()), force) {
            safe { api.absen() }
        }

    suspend fun markKehadiran(token: String): ApiResult<KehadiranResponse> = safe { api.markKehadiran(KehadiranRequest(token)) }

    /**
     * Fresh cache → serve instantly, never hitting the network.
     * Stale cache → serve the stale value instantly AND re-fetch in the
     * background to warm the cache for the next visit (no visible spinner).
     * Cold cache → try the on-disk cache first (no spinner after a relaunch),
     * and only block on the network if the disk is also empty/too old.
     *
     * A background refresh is skipped if one is already in flight for the key,
     * and its result is written back to memory + disk only on success.
     */
    private suspend fun <T> cached(
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
        val prev = cache.get<T>(key)
        when (prev) {
            is DataCache.Cached.Fresh -> {
                return prev.data
            }

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
        refreshScope.launch {
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
    private fun <T> persist(
        key: String,
        serializer: KSerializer<T>,
        result: ApiResult<T>,
    ) {
        val value = (result as? ApiResult.Success)?.data ?: return
        val payload = runCatching { json.encodeToString(serializer, value) }.getOrNull() ?: return
        refreshScope.launch {
            runCatching { persistent.save(key, payload, System.currentTimeMillis()) }
        }
    }

    /**
     * Maps every backend call into [ApiResult] (see [ErrorType]). A 401 is both
     * surfaced as [ErrorType.UNAUTHORIZED] AND pushed to [onSessionExpired] so
     * the app-wide re-login dialog appears even when the failing call came from
     * a background refresh the screen never surfaces.
     */
    private suspend fun <T> safe(block: suspend () -> T): ApiResult<T> =
        try {
            ApiResult.Success(block())
        } catch (e: HttpException) {
            val type = typeForHttp(e.code())
            if (type == ErrorType.UNAUTHORIZED) onSessionExpired()
            ApiResult.Error(e.code(), e.message() ?: "HTTP ${e.code()}", type)
        } catch (e: IOException) {
            ApiResult.Error(null, "Tidak dapat terhubung ke server: ${e.message}", ErrorType.NETWORK)
        } catch (e: SerializationException) {
            ApiResult.Error(null, "Respons tidak dapat dibaca", ErrorType.SERVER)
        } catch (e: Exception) {
            ApiResult.Error(null, e.message ?: "Terjadi kesalahan", ErrorType.SERVER)
        }
}

private fun typeForHttp(code: Int): ErrorType =
    when (code) {
        401 -> ErrorType.UNAUTHORIZED
        404 -> ErrorType.NOT_FOUND
        in 400..499 -> ErrorType.UPSTREAM
        else -> ErrorType.SERVER
    }
