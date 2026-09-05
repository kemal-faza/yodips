package ac.undip.sso.core.network

/**
 * Backend REST contract consumed by the mobile UI (JWT-guarded routes).
 * The `Authorization: Bearer` header is injected by KtorSsoApi / Backend's
 * defaultRequest — no per-call header needed here.
 *
 * Routes (all JWT-guarded):
 *   GET  /api/siap/profile
 *   GET  /api/siap/irs
 *   GET  /api/siap/khs
 *   GET  /api/siap/jadwal
 *   GET  /api/kulon/assignments/all
 *   GET  /api/kulon/courses
 *   GET  /api/kulon/courses/:id/content
 *   GET  /api/siap/lecturers
 *   GET  /api/siap/absen
 *   POST /api/notifications/device
 *   DELETE /api/notifications/device
 *   GET  /api/notifications/vapid-public-key
 *   POST /api/notifications/web-device
 *   DELETE /api/notifications/web-device
 *   POST /api/auth/logout
 *   POST /api/siap/kehadiran
 */
interface SsoApi {
    /** GET /api/siap/profile */
    suspend fun profile(): SiapProfile

    /** GET /api/siap/irs */
    suspend fun irs(): SiapIrs

    /** GET /api/siap/khs */
    suspend fun khs(): SiapKhs

    /** GET /api/siap/jadwal */
    suspend fun jadwal(): List<SiapJadwal>

    /** GET /api/kulon/assignments/all */
    suspend fun assignments(): List<KulonAssignment>

    /** GET /api/kulon/assignments/:id/detail?cmid= */
    suspend fun assignmentDetail(assignmentId: Long, cmid: Long): KulonAssignmentDetail

    /** GET /api/kulon/courses */
    suspend fun courses(): List<KulonCourse>

    /** GET /api/kulon/courses/:id/content */
    suspend fun courseContent(courseId: Long): KulonCourseContent

    /** GET /api/siap/lecturers */
    suspend fun lecturers(): List<SiapLecturer>

    /** GET /api/siap/absen */
    suspend fun absen(): List<SiapAbsen>

    /** POST /api/notifications/device */
    suspend fun registerPushDevice(body: PushDeviceRequest): PushDeviceResponse

    /** DELETE /api/notifications/device */
    suspend fun unregisterPushDevice(body: PushDeviceRequest): PushDeviceResponse

    /** GET /api/notifications/vapid-public-key */
    suspend fun vapidPublicKey(): VapidPublicKeyResponse

    /** POST /api/notifications/web-device (daftarkan subscription Web Push PWA) */
    suspend fun registerWebPushDevice(body: WebPushDeviceRequest): PushDeviceResponse

    /** DELETE /api/notifications/web-device (cabut subscription Web Push PWA) */
    suspend fun unregisterWebPushDevice(body: WebPushDeviceRequest): PushDeviceResponse

    /** POST /api/siap/kehadiran */
    suspend fun markKehadiran(body: KehadiranRequest): KehadiranResponse

    /** POST /api/auth/logout — server-side session revocation. The bearer is
     *  attached by the shared client. Non-2xx throws [ApiHttpException].
     *  Backend contract: accepts valid-or-expired signed tokens and clears the
     *  session record; 401 when the token generation is stale (never clears a
     *  newer session). */
    suspend fun logout(): LogoutResponse
}
