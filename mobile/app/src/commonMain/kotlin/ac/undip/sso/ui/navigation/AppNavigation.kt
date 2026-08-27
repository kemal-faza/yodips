package ac.undip.sso.ui.navigation

import androidx.compose.runtime.compositionLocalOf

/**
 * Per-screen hook for a screen (e.g. the Scan tab) to ask the AppShell to leave
 * the current tab and return to the Dashboard. Provided by [AppShell]; read via
 * [LocalAppNavigation]. Null when not inside the shell (e.g. LoginScreen).
 */
class AppNavigation(
    val onNavigateDashboard: () -> Unit,
)

/** CompositionLocal that AppShell provides; screens read it to navigate home. */
val LocalAppNavigation = compositionLocalOf<AppNavigation?> { null }
