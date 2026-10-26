package ac.undip.sso.ui.login

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * Release counterpart of the debug-only probe harness.
 *
 * The real implementation lives in `src/debug/java` so its WebView wiring and
 * diagnostic strings cannot reach a release APK: R8 is disabled, so merely
 * guarding a composable with `BuildConfig.DEBUG` would still ship the code.
 * Keeping the signature identical lets `AppRoot` (main) call it on every variant.
 */
@Composable
internal fun DebugKulonTicketProbe(modifier: Modifier = Modifier) {
    // Intentionally empty: release builds expose no probe UI.
}
