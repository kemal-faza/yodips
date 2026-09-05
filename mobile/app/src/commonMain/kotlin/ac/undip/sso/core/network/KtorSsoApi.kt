package ac.undip.sso.core.network

import io.ktor.client.HttpClient
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.isSuccess
import io.ktor.http.contentType
import io.ktor.client.request.request
import kotlinx.serialization.json.Json

/**
 * Ktor-based [SsoApi] implementation. Every request carries the Bearer token
 * in the HttpClient's defaultRequest. JSON parsing uses a lenient [Json]
 * instance that ignores unknown keys and coerces input values.
 *
 * Non-2xx responses are thrown as [ApiHttpException].
 */
class KtorSsoApi(
    private val client: HttpClient,
    private val baseUrl: String,
    private val authTokenProvider: () -> String?,
) : SsoApi {
    private val root = baseUrl.trimEnd('/')
    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        isLenient = true
    }

    private suspend fun handle(resp: HttpResponse): String {
        val text = resp.bodyAsText()
        if (!resp.status.isSuccess()) {
            throw ApiHttpException(resp.status.value, text.take(200))
        }
        return text
    }

    override suspend fun profile(): SiapProfile {
        val resp = client.get("$root/api/siap/profile")
        return json.decodeFromString<SiapProfile>(handle(resp))
    }

    override suspend fun irs(): SiapIrs {
        val resp = client.get("$root/api/siap/irs")
        return json.decodeFromString<SiapIrs>(handle(resp))
    }

    override suspend fun khs(): SiapKhs {
        val resp = client.get("$root/api/siap/khs")
        return json.decodeFromString<SiapKhs>(handle(resp))
    }

    override suspend fun jadwal(): List<SiapJadwal> {
        val resp = client.get("$root/api/siap/jadwal")
        return json.decodeFromString<List<SiapJadwal>>(handle(resp))
    }

    override suspend fun assignments(): List<KulonAssignment> {
        val resp = client.get("$root/api/kulon/assignments/all")
        return json.decodeFromString<List<KulonAssignment>>(handle(resp))
    }

    override suspend fun assignmentDetail(assignmentId: Long, cmid: Long): KulonAssignmentDetail {
        val resp = client.get("$root/api/kulon/assignments/$assignmentId/detail") {
            parameter("cmid", cmid)
        }
        return json.decodeFromString<KulonAssignmentDetail>(handle(resp))
    }

    override suspend fun courses(): List<KulonCourse> {
        val resp = client.get("$root/api/kulon/courses")
        return json.decodeFromString<List<KulonCourse>>(handle(resp))
    }

    override suspend fun courseContent(courseId: Long): KulonCourseContent {
        val resp = client.get("$root/api/kulon/courses/$courseId/content")
        return json.decodeFromString<KulonCourseContent>(handle(resp))
    }

    override suspend fun lecturers(): List<SiapLecturer> {
        val resp = client.get("$root/api/siap/lecturers")
        return json.decodeFromString<List<SiapLecturer>>(handle(resp))
    }

    override suspend fun absen(): List<SiapAbsen> {
        val resp = client.get("$root/api/siap/absen")
        return json.decodeFromString<List<SiapAbsen>>(handle(resp))
    }

    override suspend fun registerPushDevice(body: PushDeviceRequest): PushDeviceResponse {
        val resp = client.post("$root/api/notifications/device") {
            setBody(json.encodeToString(body))
            contentType(ContentType.Application.Json)
        }
        return json.decodeFromString<PushDeviceResponse>(handle(resp))
    }

    override suspend fun markKehadiran(body: KehadiranRequest): KehadiranResponse {
        val resp = client.post("$root/api/siap/kehadiran") {
            setBody(json.encodeToString(body))
            contentType(ContentType.Application.Json)
        }
        return json.decodeFromString<KehadiranResponse>(handle(resp))
    }

    override suspend fun unregisterPushDevice(body: PushDeviceRequest): PushDeviceResponse {
        val resp = client.request("$root/api/notifications/device") {
            method = HttpMethod.Delete
            setBody(json.encodeToString(body))
            contentType(ContentType.Application.Json)
        }
        return json.decodeFromString<PushDeviceResponse>(handle(resp))
    }

    override suspend fun vapidPublicKey(): VapidPublicKeyResponse {
        val resp = client.get("$root/api/notifications/vapid-public-key")
        return json.decodeFromString<VapidPublicKeyResponse>(handle(resp))
    }

    override suspend fun registerWebPushDevice(body: WebPushDeviceRequest): PushDeviceResponse {
        val resp = client.post("$root/api/notifications/web-device") {
            setBody(json.encodeToString(body))
            contentType(ContentType.Application.Json)
        }
        return json.decodeFromString<PushDeviceResponse>(handle(resp))
    }

    override suspend fun unregisterWebPushDevice(body: WebPushDeviceRequest): PushDeviceResponse {
        val resp = client.request("$root/api/notifications/web-device") {
            method = HttpMethod.Delete
            setBody(json.encodeToString(body))
            contentType(ContentType.Application.Json)
        }
        return json.decodeFromString<PushDeviceResponse>(handle(resp))
    }

    override suspend fun logout(): LogoutResponse {
        val resp = client.post("$root/api/auth/logout") {
            // Empty JSON body + explicit content type (pattern yang sama dengan
            // Backend.refresh) — MockEngine/ktor meng-expose Content-Type lewat
            // body.contentType hanya bila ada body yang ter-set.
            setBody(ByteArray(0))
            contentType(ContentType.Application.Json)
        }
        return json.decodeFromString<LogoutResponse>(handle(resp))
    }
}
