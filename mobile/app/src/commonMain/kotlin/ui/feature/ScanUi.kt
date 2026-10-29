package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.ErrorType
import ac.undip.sso.core.network.KehadiranResponse
import ac.undip.sso.core.network.MeResponse
import ac.undip.sso.core.network.UpstreamSessionService
import ac.undip.sso.core.network.UserMessages
import ac.undip.sso.ui.common.LoadableData
import ac.undip.sso.ui.common.StaleSessionState
import ac.undip.sso.ui.navigation.LocalAppNavigation
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

/**
 * Result of interpreting a presence (absen) attendance response, for surfacing
 * in the QR scan UI. Pure so it is unit-testable without camera/network.
 */
data class ScanOutcome(
    val success: Boolean,
    val message: String,
    val staleSession: Boolean = false,
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
            ScanOutcome(success = !explicitFailure, message = if (explicitFailure) UserMessages.QR_INVALID else "Berhasil Absen")
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
                    ScanOutcome(false, UserMessages.QR_INVALID)
                }

                ErrorType.STALE_SESSION -> {
                    ScanOutcome(false, "Sesi SIAP kedaluwarsa. Silakan login ulang.", staleSession = true)
                }

                ErrorType.SESSION_RECOVERED -> {
                    ScanOutcome(false, result.message)
                }

                ErrorType.RECOVERY_UNSUPPORTED -> {
                    ScanOutcome(false, result.message)
                }

                ErrorType.NOT_FOUND, ErrorType.SERVER -> {
                    ScanOutcome(false, fallback)
                }
            }
        }
    }

/** Scan needs a valid SIAP session; Kulon/SSO alone cannot record attendance. */
internal fun scanAllowed(me: MeResponse): Boolean = me.hasSiap

/**
 * QR presence scanner entry point. The common preflight gates the platform
 * camera on a live SIAP session so a stale session shows a re-login CTA
 * instead of a camera that can only fail on submit.
 */
@Composable
internal fun ScanScreen(repo: SsoRepository) {
    val nav = LocalAppNavigation.current
    FeatureScreen(
        title = "Scan QR",
        onBack = nav?.let { { it.onNavigateDashboard() } },
    ) {
        LoadableData(
            load = { repo.sessionStatus() },
            loading = {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            },
        ) { me ->
            if (scanAllowed(me)) {
                ScanCamera(repo)
            } else {
                StaleSessionState(UpstreamSessionService.SIAP)
            }
        }
    }
}

@Composable
internal expect fun ScanCamera(repo: SsoRepository)
