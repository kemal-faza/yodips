package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.Backend
import ac.undip.sso.core.network.ErrorType
import ac.undip.sso.core.network.KehadiranRequest
import ac.undip.sso.core.network.KehadiranResponse
import ac.undip.sso.core.network.KulonAssignment
import ac.undip.sso.core.network.KulonAssignmentDetail
import ac.undip.sso.core.network.KulonCourse
import ac.undip.sso.core.network.KulonCourseContent
import ac.undip.sso.core.network.MeResponse
import ac.undip.sso.core.network.PushDeviceRequest
import ac.undip.sso.core.network.PushDeviceResponse
import ac.undip.sso.core.network.SiapAbsen
import ac.undip.sso.core.network.SiapIrs
import ac.undip.sso.core.network.SiapJadwal
import ac.undip.sso.core.network.SiapKhs
import ac.undip.sso.core.network.SiapLecturer
import ac.undip.sso.core.network.SiapNilaiDetail
import ac.undip.sso.core.network.SiapProfile
import ac.undip.sso.core.network.SessionExpiredEvents
import ac.undip.sso.core.network.SsoApi
import ac.undip.sso.core.network.UpstreamSessionService
import ac.undip.sso.core.network.jwtSessionGeneration
import ac.undip.sso.ioDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer

/**
 * Minimal seam so tests can fake the token store without a real DataStore.
 */
interface TokenStoreLike {
    val siapCookie: Flow<String?>
    val kulonCookie: Flow<String?>
    suspend fun save(token: String, siap: String?, kulon: String?)
    /** Rotate only if no later login has replaced the token. */
    suspend fun replaceTokenIfCurrent(expected: String?, replacement: String): Boolean {
        if (currentToken() != expected) return false
        save(replacement, null, null)
        return true
    }
    /** Replace one cookie only while the stored JWT still names this generation. */
    suspend fun updateUpstreamCookie(
        service: UpstreamSessionService,
        cookie: String,
        expectedGeneration: String,
    ): CookieUpdateResult = CookieUpdateResult.UNSUPPORTED
    suspend fun currentToken(): String?
    suspend fun clear()
}

enum class CookieUpdateResult {
    UPDATED,
    UNSUPPORTED,
    FAILED,
    SESSION_CHANGED,
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
    private val api: SsoApi = Backend.api,
    cache: DataCache = InMemoryDataCache(),
    persistent: PersistentCache = NoOpPersistentCache,
    diskMaxAgeMs: Long = DEFAULT_DISK_MAX_AGE_MS,
    private val onSessionExpired: () -> Unit = SessionExpiredEvents::notifySessionExpired,
    private val tokenStore: TokenStoreLike? = null,
    refreshToken: suspend () -> String = { Backend.refresh() },
    directTicketCapture: DirectTicketCapture? = null,
) {
    private val supportsSiapRecovery = directTicketCapture != null
    // Stale-while-revalidate refreshes must not block callers nor outlive a
    // screen: a supervised IO scope owned by the repository.
    private val refreshScope = CoroutineScope(SupervisorJob() + ioDispatcher)

    // Latest result per fixed source, exposed so a screen re-entered in the same
    // process can render its cached value in the first frame (no skeleton flash)
    // and still receive silent background-refresh updates. The map is immutable
    // after construction; StateFlow writes are thread-safe.
    private val states: Map<String, MutableStateFlow<ApiResult<*>?>> =
        CacheKeys.ALL.associateWith { MutableStateFlow<ApiResult<*>?>(null) }

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

    private val recoveryCoordinator = tokenStore?.let { store ->
        SessionRecoveryCoordinator(
            capture = directTicketCapture ?: DirectTicketCapture { DirectTicketCaptureResult.Unsupported },
            renewal = api,
            tokenStore = store,
            readCurrentStatus = { api.me(); Unit },
        )
    }

    /**
     * Observable latest result for a fixed cache key ([CacheKeys]). Screens use
     * it to seed their UI from the already-cached value: re-entering a page shows
     * content immediately, and a stale-while-revalidate background refresh
     * updates it in place. Unknown keys return null — dynamic cache keys
     * (e.g. course content) intentionally stay non-observable.
     */
    @Suppress("UNCHECKED_CAST")
    fun <T> state(key: String): StateFlow<ApiResult<T>?>? = states[key]?.let { it as StateFlow<ApiResult<T>?> }

    /**
     * Rarely-changing data: cache-only by default (`revalidate = false`) —
     * entering a screen serves the cached value without any network work.
     * `force = true` (pull-to-refresh) fetches fresh; a cold miss (or a disk
     * entry older than [DEFAULT_DISK_MAX_AGE_MS]) still fetches.
     */
    suspend fun profile(
        force: Boolean = false,
        revalidate: Boolean = false,
    ): ApiResult<SiapProfile> =
        cached(CacheKeys.PROFILE, SiapProfile.serializer(), force, revalidate) {
            upstreamRead(UpstreamSessionService.SIAP) { api.profile() }
        }

    /** GET /api/auth/me — status sesi upstream (dipakai deteksi dini saat boot:
     *  `complete=false` → tampilkan dialog login ulang tanpa menunggu aksi
     *  pengguna). RETRYABLE: 401 berarti JWT bisa saja hanya kedaluwarsa walau
     *  sesi backend masih hidup → coba silent refresh dulu (rotasi diam-diam),
     *  baru dialog bila refresh sendiri 401 (SESSION_DEAD). Network error
     *  dibiarkan (offline ≠ sesi mati). */
    suspend fun sessionStatus(): ApiResult<MeResponse> =
        refresher.safe(retryable = true, serviceStale = false) { api.me() }

    /**
     * Refresh proaktif JWT (lihat [SessionRefresher.ensureFresh]) — dipanggil
     * saat app start & kembali ke foreground supaya sesi aktif tidak pernah
     * menyentuh 401 hanya karena token "patut dirotasi".
     */
    suspend fun ensureFreshSession(): SessionRefresher.RefreshResult =
        refresher.ensureFresh()

    suspend fun irs(
        force: Boolean = false,
        revalidate: Boolean = false,
    ): ApiResult<SiapIrs> =
        cached(CacheKeys.IRS, SiapIrs.serializer(), force, revalidate) {
            upstreamRead(UpstreamSessionService.SIAP) { api.irs() }
        }

    suspend fun khs(
        force: Boolean = false,
        revalidate: Boolean = false,
    ): ApiResult<SiapKhs> =
        cached(CacheKeys.KHS, SiapKhs.serializer(), force, revalidate) {
            upstreamRead(UpstreamSessionService.SIAP) { api.khs() }
        }

    /** Rincian nilai per komponen satu matkul — JANGAN di-cache (data nilai
     *  bisa berubah pasca-pengumuman; endpoint ringan). */
    suspend fun nilaiDetail(id: String): ApiResult<SiapNilaiDetail> =
        upstreamRead(UpstreamSessionService.SIAP) { api.nilaiDetail(id) }

    /**
     * Dynamic (per-meeting) data: SWR by default. Callers joining it into a
     * rarely-changing screen (IRS) pass `revalidate = false` so that screen
     * performs no background network work on entry.
     */
    suspend fun jadwal(
        force: Boolean = false,
        revalidate: Boolean = true,
    ): ApiResult<List<SiapJadwal>> =
        cached(CacheKeys.JADWAL, ListSerializer(SiapJadwal.serializer()), force, revalidate) {
            upstreamRead(UpstreamSessionService.SIAP) { api.jadwal() }
        }

    suspend fun assignments(force: Boolean = false): ApiResult<List<KulonAssignment>> =
        cached(CacheKeys.ASSIGNMENTS, ListSerializer(KulonAssignment.serializer()), force) {
            upstreamRead(UpstreamSessionService.KULON) { api.assignments() }
        }

    /** Detail satu tugas — JANGAN di-cache (isi bisa berubah sering, dan payload kecil). */
    suspend fun assignmentDetail(
        assignmentId: Long,
        cmid: Long,
    ): ApiResult<KulonAssignmentDetail> =
        upstreamRead(UpstreamSessionService.KULON) {
            api.assignmentDetail(assignmentId, cmid)
        }

    suspend fun courses(force: Boolean = false): ApiResult<List<KulonCourse>> =
        cached(CacheKeys.COURSES, ListSerializer(KulonCourse.serializer()), force) {
            upstreamRead(UpstreamSessionService.KULON) { api.courses() }
        }

    /** Lightweight course list for task filtering; omits progress/lecturer work. */
    suspend fun courseList(force: Boolean = false): ApiResult<List<KulonCourse>> =
        cached(CacheKeys.COURSES_LIST, ListSerializer(KulonCourse.serializer()), force) {
            upstreamRead(UpstreamSessionService.KULON) { api.courses(list = true) }
        }

    /** Konten course (sections + items) — di-cache per course, back/forth tanpa refetch. */
    suspend fun courseContent(courseId: Long, force: Boolean = false): ApiResult<KulonCourseContent> =
        cached("course-content-$courseId", KulonCourseContent.serializer(), force) {
            upstreamRead(UpstreamSessionService.KULON) { api.courseContent(courseId) }
        }

    suspend fun lecturers(
        force: Boolean = false,
        revalidate: Boolean = true,
    ): ApiResult<List<SiapLecturer>> =
        cached(CacheKeys.LECTURERS, ListSerializer(SiapLecturer.serializer()), force, revalidate) {
            upstreamRead(UpstreamSessionService.SIAP) { api.lecturers() }
        }

    suspend fun absen(
        force: Boolean = false,
        revalidate: Boolean = true,
    ): ApiResult<List<SiapAbsen>> =
        cached(CacheKeys.ABSEN, ListSerializer(SiapAbsen.serializer()), force, revalidate) {
            upstreamRead(UpstreamSessionService.SIAP) { api.absen() }
        }

    suspend fun markKehadiran(token: String): ApiResult<KehadiranResponse> {
        val generation = tokenStore?.currentToken()?.let(::jwtSessionGeneration)
        val result = refresher.safe(retryable = false, serviceStale = true) {
            api.markKehadiran(KehadiranRequest(token))
        }
        val stale = result as? ApiResult.Error ?: return result
        if (stale.type != ErrorType.STALE_SESSION || !supportsSiapRecovery || generation == null ||
            tokenStore.currentToken()?.let(::jwtSessionGeneration) != generation) return stale
        val outcome = recoveryCoordinator?.recover(generation, UpstreamSessionService.SIAP)
            ?: SessionRecoveryOutcome.UNSUPPORTED
        if (outcome == SessionRecoveryOutcome.RECOVERED) {
            // The original QR POST is never replayed: let the user decide whether
            // to send a fresh scan after the session has been restored. The
            // previous attempt may still have been recorded (a 200 with an
            // unparsable body is reported as a stale 401), so the copy must not
            // claim the submission definitely failed.
            return ApiResult.Error(
                stale.code,
                "Sesi SIAP pulih. Silakan scan ulang hanya jika presensi sebelumnya belum tercatat.",
                ErrorType.SESSION_RECOVERED,
            )
        }
        return recoveryError(stale, outcome, UpstreamSessionService.SIAP)
    }

    /** Registrasi token push ke backend (idempotent di server -> retryable). */
    suspend fun registerPushDevice(token: String): ApiResult<PushDeviceResponse> =
        refresher.safe(retryable = true) { api.registerPushDevice(PushDeviceRequest(token)) }

    suspend fun unregisterPushDevice(token: String): ApiResult<PushDeviceResponse> =
        refresher.safe(retryable = false) { api.unregisterPushDevice(PushDeviceRequest(token)) }

    /** Cancel ticket recovery and clear user-scoped memory/disk cache on logout. */
    suspend fun clearForLogout() {
        try {
            refresher.clearForLogout()
            recoveryCoordinator?.clear()
        } finally {
            // Cancel refreshes and wipe the cache FIRST; only then drop the
            // observable state, so an in-flight publish that already passed its
            // generation check cannot land after the reset.
            cacheCoordinator.clear()
            states.values.forEach { it.value = null }
        }
    }

    suspend fun resumeForNewSession() {
        refresher.resumeForNewSession()
        recoveryCoordinator?.resumeForNewSession()
    }

    private suspend fun <T> upstreamRead(service: UpstreamSessionService, block: suspend () -> T): ApiResult<T> {
        val generationBeforeRequest = tokenStore?.currentToken()?.let(::jwtSessionGeneration)
        val initial = refresher.safe(serviceStale = true, block = block)
        val stale = initial as? ApiResult.Error ?: return initial
        if (stale.type != ErrorType.STALE_SESSION) return initial
        // PWA has no cookie-capture adapter; preserve its existing behavior.
        if (service == UpstreamSessionService.SIAP && !supportsSiapRecovery) return initial

        val generation = generationBeforeRequest ?: return recoveryError(stale, SessionRecoveryOutcome.UNSUPPORTED, service)
        // A logout or a replacement login may cross the upstream response. Do
        // not open a ticket or apply its result to a different local session.
        if (tokenStore.currentToken()?.let(::jwtSessionGeneration) != generation) {
            return ApiResult.Error(stale.code, "Sesi berubah. Muat ulang data ${service.name}.", stale.type)
        }

        val outcome = recoveryCoordinator?.recover(generation, service)
            ?: SessionRecoveryOutcome.UNSUPPORTED
        if (outcome != SessionRecoveryOutcome.RECOVERED) return recoveryError(stale, outcome, service)

        // Recovery is intentionally non-recursive. The recovered cookie is
        // persisted before this one final read; a second stale response is
        // returned to the screen and cannot trigger another ticket flow.
        if (tokenStore.currentToken()?.let(::jwtSessionGeneration) != generation) {
            return ApiResult.Error(stale.code, "Sesi berubah. Muat ulang data ${service.name}.", stale.type)
        }
        return refresher.safe(retryable = false, serviceStale = true, block = block)
    }

    private fun recoveryError(
        previous: ApiResult.Error,
        outcome: SessionRecoveryOutcome,
        service: UpstreamSessionService,
    ): ApiResult.Error = when (outcome) {
        SessionRecoveryOutcome.RECOVERED -> previous
        SessionRecoveryOutcome.SESSION_DEAD -> {
            onSessionExpired()
            ApiResult.Error(401, "Sesi YoDips sudah berakhir. Silakan login kembali.", ErrorType.UNAUTHORIZED)
        }
        SessionRecoveryOutcome.AUTH_REJECTED ->
            ApiResult.Error(previous.code, "Server menolak token YoDips. Sesi lokal tetap disimpan.", ErrorType.UNAUTHORIZED)
        SessionRecoveryOutcome.SESSION_CHANGED ->
            ApiResult.Error(previous.code, "Sesi berubah. Muat ulang data Kulon.", previous.type)
        SessionRecoveryOutcome.INTERACTION_REQUIRED ->
            ApiResult.Error(previous.code, "Login Microsoft diperlukan untuk memulihkan sesi ${service.name}.", previous.type)
        SessionRecoveryOutcome.CONFLICT ->
            ApiResult.Error(409, "Sesi ${service.name} berubah di perangkat lain. Muat ulang data.", previous.type)
        SessionRecoveryOutcome.NETWORK_FAILURE ->
            ApiResult.Error(null, "Jaringan gagal saat memulihkan sesi ${service.name}.", ErrorType.NETWORK)
        SessionRecoveryOutcome.UPSTREAM_INVALID ->
            ApiResult.Error(previous.code, "Ticket ${service.name} tidak menghasilkan sesi yang valid.", previous.type)
        SessionRecoveryOutcome.UNSUPPORTED ->
            ApiResult.Error(
                previous.code,
                "Pemulihan ${service.name} tidak tersedia di platform ini. Lanjutkan lewat YoDips Android.",
                ErrorType.RECOVERY_UNSUPPORTED,
            )
        SessionRecoveryOutcome.PERSISTENCE_FAILURE ->
            ApiResult.Error(null, "Cookie Kulon baru tidak dapat disimpan dengan aman.", ErrorType.SERVER)
    }

    private suspend fun <T> cached(
        key: String,
        serializer: KSerializer<T>,
        force: Boolean,
        revalidate: Boolean = true,
        block: suspend () -> ApiResult<T>,
    ): ApiResult<T> =
        cacheCoordinator.cached(
            key = key,
            serializer = serializer,
            force = force,
            revalidate = revalidate,
            onValue = { result -> states[key]?.value = result },
            block = block,
        )
}
