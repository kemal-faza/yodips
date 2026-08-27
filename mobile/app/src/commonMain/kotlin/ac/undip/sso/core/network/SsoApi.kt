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
 *   GET  /api/siap/lecturers
 *   GET  /api/siap/absen
 *   POST /api/notifications/device
 *   DELETE /api/notifications/device
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

    /** GET /api/siap/lecturers */
    suspend fun lecturers(): List<SiapLecturer>

    /** GET /api/siap/absen */
    suspend fun absen(): List<SiapAbsen>

    /** POST /api/notifications/device */
    suspend fun registerPushDevice(body: PushDeviceRequest): PushDeviceResponse

    /** DELETE /api/notifications/device */
    suspend fun unregisterPushDevice(body: PushDeviceRequest): PushDeviceResponse

    /** POST /api/siap/kehadiran */
    suspend fun markKehadiran(body: KehadiranRequest): KehadiranResponse
}
