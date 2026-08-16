package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiClient
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.ErrorType
import ac.undip.sso.core.network.KehadiranRequest
import ac.undip.sso.core.network.KehadiranResponse
import ac.undip.sso.core.network.KulonAssignment
import ac.undip.sso.core.network.SiapIrs
import ac.undip.sso.core.network.SiapJadwal
import ac.undip.sso.core.network.SiapKhs
import ac.undip.sso.core.network.SiapProfile
import ac.undip.sso.core.network.SsoApi
import kotlinx.serialization.SerializationException
import retrofit2.HttpException
import java.io.IOException

/**
 * Repository: maps every Retrofit call into [ApiResult] with a coarse error
 * taxonomy (see [ErrorType]). Screens clamp to Loading/Empty/Error/Content.
 * A [retrofit2.HttpException] 401 is surfaced as [ErrorType.UNAUTHORIZED] so
 * the app can trigger a re-login; network/parse failures map to NETWORK/SERVER.
 */
class SsoRepository(
    private val api: SsoApi = ApiClient.api,
) {
    suspend fun profile(): ApiResult<SiapProfile> = safe { api.profile() }

    suspend fun irs(): ApiResult<SiapIrs> = safe { api.irs() }

    suspend fun khs(): ApiResult<SiapKhs> = safe { api.khs() }

    suspend fun jadwal(): ApiResult<List<SiapJadwal>> = safe { api.jadwal() }

    suspend fun assignments(): ApiResult<List<KulonAssignment>> = safe { api.assignments() }

    suspend fun markKehadiran(token: String): ApiResult<KehadiranResponse> = safe { api.markKehadiran(KehadiranRequest(token)) }
}

private suspend fun <T> safe(block: suspend () -> T): ApiResult<T> =
    try {
        ApiResult.Success(block())
    } catch (e: HttpException) {
        ApiResult.Error(e.code(), e.message() ?: "HTTP ${e.code()}", typeForHttp(e.code()))
    } catch (e: IOException) {
        ApiResult.Error(null, "Tidak dapat terhubung ke server: ${e.message}", ErrorType.NETWORK)
    } catch (e: SerializationException) {
        ApiResult.Error(null, "Respons tidak dapat dibaca", ErrorType.SERVER)
    } catch (e: Exception) {
        ApiResult.Error(null, e.message ?: "Terjadi kesalahan", ErrorType.SERVER)
    }

private fun typeForHttp(code: Int): ErrorType =
    when (code) {
        401 -> ErrorType.UNAUTHORIZED
        404 -> ErrorType.NOT_FOUND
        in 400..499 -> ErrorType.UPSTREAM
        else -> ErrorType.SERVER
    }
