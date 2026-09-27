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
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer

/**
 * Minimal seam so tests can fake the token store without a real DataStore.
 */
interface TokenStoreLike {
    val siapCookie: Flow<String?>
    val kulonCookie: Flow<String?>
    suspend fun save(token: String, siap: String?, kulon: String?)
    /** Atomically replace only the Kulon cookie; unsupported stores do no write. */
    suspend fun updateKulonCookie(cookie: String): CookieUpdateResult = CookieUpdateResult.UNSUPPORTED
    suspend fun currentToken(): String?
    suspend fun clear()
}

enum class CookieUpdateResult {
    UPDATED,
    UNSUPPORTED,
    FAILED,
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
    // Stale-while-revalidate refreshes must not block callers nor outlive a
    // screen: a supervised IO scope owned by the repository.
    private val refreshScope = CoroutineScope(SupervisorJob() + ioDispatcher)

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

    suspend fun profile(force: Boolean = false): ApiResult<SiapProfile> =
        cached("profile", SiapProfile.serializer(), force) {
            refresher.safe(serviceStale = true) { api.profile() }
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

    suspend fun irs(force: Boolean = false): ApiResult<SiapIrs> =
        cached("irs", SiapIrs.serializer(), force) {
            refresher.safe(serviceStale = true) { api.irs() }
        }

    suspend fun khs(force: Boolean = false): ApiResult<SiapKhs> =
        cached("khs", SiapKhs.serializer(), force) {
            refresher.safe(serviceStale = true) { api.khs() }
        }

    /** Rincian nilai per komponen satu matkul — JANGAN di-cache (data nilai
     *  bisa berubah pasca-pengumuman; endpoint ringan). */
    suspend fun nilaiDetail(id: String): ApiResult<SiapNilaiDetail> =
        refresher.safe(serviceStale = true) { api.nilaiDetail(id) }

    suspend fun jadwal(force: Boolean = false): ApiResult<List<SiapJadwal>> =
        cached("jadwal", ListSerializer(SiapJadwal.serializer()), force) {
            refresher.safe(serviceStale = true) { api.jadwal() }
        }

    suspend fun assignments(force: Boolean = false): ApiResult<List<KulonAssignment>> =
        cached("assignments", ListSerializer(KulonAssignment.serializer()), force) {
            kulonRead { api.assignments() }
        }

    /** Detail satu tugas — JANGAN di-cache (isi bisa berubah sering, dan payload kecil). */
    suspend fun assignmentDetail(
        assignmentId: Long,
        cmid: Long,
    ): ApiResult<KulonAssignmentDetail> =
        kulonRead {
            api.assignmentDetail(assignmentId, cmid)
        }

    suspend fun courses(force: Boolean = false): ApiResult<List<KulonCourse>> =
        cached("courses", ListSerializer(KulonCourse.serializer()), force) {
            kulonRead { api.courses() }
        }

    /** Lightweight course list for task filtering; omits progress/lecturer work. */
    suspend fun courseList(force: Boolean = false): ApiResult<List<KulonCourse>> =
        cached("courses:list", ListSerializer(KulonCourse.serializer()), force) {
            kulonRead { api.courses(list = true) }
        }

    /** Konten course (sections + items) — di-cache per course, back/forth tanpa refetch. */
    suspend fun courseContent(courseId: Long, force: Boolean = false): ApiResult<KulonCourseContent> =
        cached("course-content-$courseId", KulonCourseContent.serializer(), force) {
            kulonRead { api.courseContent(courseId) }
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

    /** Cancel ticket recovery and clear user-scoped memory/disk cache on logout. */
    suspend fun clearForLogout() {
        try {
            recoveryCoordinator?.clear()
        } finally {
            cacheCoordinator.clear()
        }
    }

    suspend fun resumeForNewSession() {
        recoveryCoordinator?.resumeForNewSession()
    }

    private suspend fun <T> kulonRead(block: suspend () -> T): ApiResult<T> {
        val generationBeforeRequest = tokenStore?.currentToken()?.let(::jwtSessionGeneration)
        val initial = refresher.safe(serviceStale = true, block = block)
        val stale = initial as? ApiResult.Error ?: return initial
        if (stale.type != ErrorType.STALE_SESSION) return initial

        val generation = generationBeforeRequest ?: return recoveryError(stale, SessionRecoveryOutcome.UNSUPPORTED)
        // A logout or a replacement login may cross the upstream response. Do
        // not open a ticket or apply its result to a different local session.
        if (tokenStore.currentToken()?.let(::jwtSessionGeneration) != generation) {
            return ApiResult.Error(stale.code, "Sesi berubah. Muat ulang data Kulon.", stale.type)
        }

        val outcome = recoveryCoordinator?.recover(generation, UpstreamSessionService.KULON)
            ?: SessionRecoveryOutcome.UNSUPPORTED
        if (outcome != SessionRecoveryOutcome.RECOVERED) return recoveryError(stale, outcome)

        // Recovery is intentionally non-recursive. The recovered cookie is
        // persisted before this one final read; a second stale response is
        // returned to the screen and cannot trigger another ticket flow.
        if (tokenStore.currentToken()?.let(::jwtSessionGeneration) != generation) {
            return ApiResult.Error(stale.code, "Sesi berubah. Muat ulang data Kulon.", stale.type)
        }
        return refresher.safe(retryable = false, serviceStale = true, block = block)
    }

    private fun recoveryError(
        previous: ApiResult.Error,
        outcome: SessionRecoveryOutcome,
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
            ApiResult.Error(previous.code, "Login Microsoft diperlukan untuk memulihkan sesi Kulon.", previous.type)
        SessionRecoveryOutcome.CONFLICT ->
            ApiResult.Error(409, "Sesi Kulon berubah di perangkat lain. Muat ulang data.", previous.type)
        SessionRecoveryOutcome.NETWORK_FAILURE ->
            ApiResult.Error(null, "Jaringan gagal saat memulihkan sesi Kulon.", ErrorType.NETWORK)
        SessionRecoveryOutcome.UPSTREAM_INVALID ->
            ApiResult.Error(previous.code, "Ticket Kulon tidak menghasilkan sesi yang valid.", previous.type)
        SessionRecoveryOutcome.UNSUPPORTED ->
            ApiResult.Error(
                previous.code,
                "Pemulihan Kulon tidak tersedia di platform ini. Lanjutkan lewat YoDips Android.",
                ErrorType.RECOVERY_UNSUPPORTED,
            )
        SessionRecoveryOutcome.PERSISTENCE_FAILURE ->
            ApiResult.Error(null, "Cookie Kulon baru tidak dapat disimpan dengan aman.", ErrorType.SERVER)
    }

    private suspend fun <T> cached(
        key: String,
        serializer: KSerializer<T>,
        force: Boolean,
        block: suspend () -> ApiResult<T>,
    ): ApiResult<T> = cacheCoordinator.cached(key, serializer, force, block)
}
