package ac.undip.sso.ui.login

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * Release counterpart of the debug-only probe harness.
 *
 * The real implementation lives in `src/debug/java`; keeping it out of the
 * release source set guarantees its WebView wiring and diagnostic strings never
 * reach a release APK, independent of R8/keep-rule changes.
 * Keeping the signature identical lets `AppRoot` (main) call it on every variant.
 */
@Composable
internal fun DebugKulonTicketProbe(modifier: Modifier = Modifier) {
    // Intentionally empty: release builds expose no probe UI.
}
