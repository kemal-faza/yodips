package ac.undip.sso.ui.theme

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * Dark-mode preference, mirroring the web theme store. Platform storage and
 * system-default detection are injected (D6) so the state machine itself is
 * common code. Behavior identical to the pre-migration class: stored pref wins,
 * otherwise the OS dark-mode setting decides; toggle persists immediately.
 */
class ThemeController(
    defaultDark: () -> Boolean,
    private val persist: (Boolean) -> Unit,
) {
    var dark by mutableStateOf(defaultDark())
        private set

    fun toggle() {
        dark = !dark
        persist(dark)
    }
}
