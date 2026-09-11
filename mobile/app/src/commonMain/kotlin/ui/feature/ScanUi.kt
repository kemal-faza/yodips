package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.ErrorType
import ac.undip.sso.core.network.KehadiranResponse
import androidx.compose.runtime.Composable

/**
 * Result of interpreting a presence (absen) attendance response, for surfacing
 * in the QR scan UI. Pure so it is unit-testable without camera/network.
 */
data class ScanOutcome(
    val success: Boolean,
    val message: String,
)

/**
 * Map the backend presence-proxy result ([SsoRepository.markKehadiran]) to a
 * concise user-facing outcome. The backend passes through SIAP's own message
 * for a business rejection (e.g. an expired/consumed QR); the /me-grade failures
 * (no-session, network, 5xx) get a generic prompt.
 */
fun scanOutcome(
    result: ApiResult<KehadiranResponse>,
    fallback: String = "Gagal mencatat kehadiran.",
): ScanOutcome =
    when (result) {
        is ApiResult.Success -> {
            // SIAP's success `status` is not a stable literal (observed "", "success",
            // "Sukses", "OK", "Berhasil", ...). Default to SUCCESS and only report a
            // failure when the response explicitly flags an error, so a genuinely
            // recorded absence is never shown as a failed scan.
            val status = result.data.status.trim().lowercase()
            val message = result.data.message.orEmpty()
            val explicitFailure =
                status in setOf("error", "gagal", "false", "0") ||
                    message.contains("tidak valid", ignoreCase = true) ||
                    message.contains("expired", ignoreCase = true) ||
                    message.contains("kedaluwarsa", ignoreCase = true) ||
                    message.contains("gagal", ignoreCase = true)
            ScanOutcome(success = !explicitFailure, message = if (explicitFailure) "QR Code Invalid" else "Berhasil Absen")
        }

        is ApiResult.Error -> {
            when (result.type) {
                ErrorType.UNAUTHORIZED -> {
                    ScanOutcome(false, "Sesi berakhir. Silakan login ulang.")
                }

                ErrorType.NETWORK -> {
                    ScanOutcome(false, "Tidak dapat terhubung ke server.")
                }

                ErrorType.UPSTREAM -> {
                    ScanOutcome(false, "QR Code Invalid")
                }

                ErrorType.STALE_SESSION -> {
                    ScanOutcome(false, "Sesi SIAP kedaluwarsa. Silakan login ulang.")
                }

                ErrorType.NOT_FOUND, ErrorType.SERVER -> {
                    ScanOutcome(false, fallback)
                }
            }
        }
    }

/**
 * QR presence scanner entry point — platform actual provides CameraX.
 */
@Composable
internal expect fun ScanScreen(repo: SsoRepository)
