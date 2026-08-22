package ac.undip.sso.core.network

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.POST

/**
 * Backend REST contract consumed by the mobile UI (JWT-guarded routes).
 * The `Authorization: Bearer` header is injected by ApiClient's OkHttp
 * interceptor (AuthHolder.authToken) — no per-call header needed here.
 */
interface SsoApi {
    @GET("api/siap/profile")
    suspend fun profile(): SiapProfile

    @GET("api/siap/irs")
    suspend fun irs(): SiapIrs

    @GET("api/siap/khs")
    suspend fun khs(): SiapKhs

    @GET("api/siap/jadwal")
    suspend fun jadwal(): List<SiapJadwal>

    // Full Kulon list (incl. completed) so the Sudah dikerjakan bucket is nonempty,
    // mirroring the web getAssignmentsAll. The feed endpoint (``/assignments``) only
    // returns outstanding items, so the DONE bucket would always stay empty.
    @GET("api/kulon/assignments/all")
    suspend fun assignments(): List<KulonAssignment>

    @GET("api/kulon/courses")
    suspend fun courses(): List<KulonCourse>

    @GET("api/siap/lecturers")
    suspend fun lecturers(): List<SiapLecturer>

    @GET("api/siap/absen")
    suspend fun absen(): List<SiapAbsen>

    /** Registrasi token FCM untuk push notification (spec §5). */
    @POST("api/notifications/device")
    suspend fun registerPushDevice(
        @Body body: PushDeviceRequest,
    ): PushDeviceResponse

    @HTTP(method = "DELETE", path = "api/notifications/device", hasBody = true)
    suspend fun unregisterPushDevice(
        @Body body: PushDeviceRequest,
    ): PushDeviceResponse

    /** Proxy a QR-scan token to SIAP presence processing. */
    @POST("api/siap/kehadiran")
    suspend fun markKehadiran(
        @Body body: KehadiranRequest,
    ): KehadiranResponse
}
