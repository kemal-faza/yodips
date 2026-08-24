package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiClient
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.KehadiranRequest
import ac.undip.sso.core.network.KehadiranResponse
import ac.undip.sso.core.network.KulonAssignment
import ac.undip.sso.core.network.KulonCourse
import ac.undip.sso.core.network.PushDeviceRequest
import ac.undip.sso.core.network.PushDeviceResponse
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
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer

/**
 * Minimal seam so tests can fake the token store without a real DataStore.
 */
interface TokenStoreLike {
    val siapCookie: Flow<String?>
    val kulonCookie: Flow<String?>
    suspend fun save(token: String, siap: String?, kulon: String?)
    suspend fun currentToken(): String?
}

/**
 * Repository FACADE over two focused internal modules (one concern per class):
 *  - [CacheCoordinator]: two-tier cache policy — memory TTL + stale-while-
 *    revalidate + disk restore/persist. Testable without token plumbing.
 *  - [SessionRefresher]: the coarse error taxonomy ([ErrorType]) plus the
 *    single-flight session refresh; on a dead session it fires
 *    [onSessionExpired] — wired to [SessionExpiredEvents] so AppRoot shows a
 *    universal re-login dialog (also covering background refreshes whose 401s
 *    the UI never surfaces).
 *
 * Screens keep calling the same suspend functions; every call maps into
 * [ApiResult] so UI can clamp to Loading/Empty/Error/Content.
 */
class SsoRepository(
    private val api: SsoApi = ApiClient.api,
    cache: DataCache = InMemoryDataCache(),
    persistent: PersistentCache = NoOpPersistentCache,
    diskMaxAgeMs: Long = DEFAULT_DISK_MAX_AGE_MS,
    onSessionExpired: () -> Unit = SessionExpiredEvents::notifySessionExpired,
    tokenStore: TokenStoreLike? = null,
    refreshToken: suspend () -> String = { ApiClient.refresh() },
) {
    // Stale-while-revalidate refreshes must not block callers nor outlive a
    // screen: a supervised IO scope owned by the repository.
    private val refreshScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val cacheCoordinator = CacheCoordinator(
        cache = cache,
        persistent = persistent,
        diskMaxAgeMs = diskMaxAgeMs,
        scope = refreshScope,
    )

    private val refresher = SessionRefresher(
        scope = refreshScope,
        refreshToken = refreshToken,
        tokenStore = tokenStore,
        onSessionExpired = onSessionExpired,
    )

    suspend fun profile(force: Boolean = false): ApiResult<SiapProfile> =
        cached("profile", SiapProfile.serializer(), force) {
            refresher.safe(serviceStale = true) { api.profile() }
        }

    suspend fun irs(force: Boolean = false): ApiResult<SiapIrs> =
        cached("irs", SiapIrs.serializer(), force) {
            refresher.safe(serviceStale = true) { api.irs() }
        }

    suspend fun khs(force: Boolean = false): ApiResult<SiapKhs> =
        cached("khs", SiapKhs.serializer(), force) {
            refresher.safe(serviceStale = true) { api.khs() }
        }

    suspend fun jadwal(force: Boolean = false): ApiResult<List<SiapJadwal>> =
        cached("jadwal", ListSerializer(SiapJadwal.serializer()), force) {
            refresher.safe(serviceStale = true) { api.jadwal() }
        }

    suspend fun assignments(force: Boolean = false): ApiResult<List<KulonAssignment>> =
        cached("assignments", ListSerializer(KulonAssignment.serializer()), force) {
            refresher.safe(serviceStale = true) { api.assignments() }
        }

    suspend fun courses(force: Boolean = false): ApiResult<List<KulonCourse>> =
        cached("courses", ListSerializer(KulonCourse.serializer()), force) {
            refresher.safe(serviceStale = true) { api.courses() }
        }

    suspend fun lecturers(force: Boolean = false): ApiResult<List<SiapLecturer>> =
        cached("lecturers", ListSerializer(SiapLecturer.serializer()), force) {
            refresher.safe(serviceStale = true) { api.lecturers() }
        }

    suspend fun absen(force: Boolean = false): ApiResult<List<SiapAbsen>> =
        cached("absen", ListSerializer(SiapAbsen.serializer()), force) {
            refresher.safe(serviceStale = true) { api.absen() }
        }

    suspend fun markKehadiran(token: String): ApiResult<KehadiranResponse> =
        refresher.safe(retryable = false, serviceStale = true) { api.markKehadiran(KehadiranRequest(token)) }

    /** Registrasi token push ke backend (idempotent di server -> retryable). */
    suspend fun registerPushDevice(token: String): ApiResult<PushDeviceResponse> =
        refresher.safe(retryable = true) { api.registerPushDevice(PushDeviceRequest(token)) }

    suspend fun unregisterPushDevice(token: String): ApiResult<PushDeviceResponse> =
        refresher.safe(retryable = false) { api.unregisterPushDevice(PushDeviceRequest(token)) }

    private suspend fun <T> cached(
        key: String,
        serializer: KSerializer<T>,
        force: Boolean,
        block: suspend () -> ApiResult<T>,
    ): ApiResult<T> = cacheCoordinator.cached(key, serializer, force, block)
}
