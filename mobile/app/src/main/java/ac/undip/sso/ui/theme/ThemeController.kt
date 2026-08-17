package ac.undip.sso.ui.theme

import android.content.Context
import android.content.res.Configuration
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * Dark-mode preference, mirroring the web theme store (saved preference else OS
 * `prefers-color-scheme`). It persists the choice in SharedPreferences so the
 * selection survives relaunches, and any read of [dark] inside a composition
 * triggers recomposition when [toggle] flips it.
 */
class ThemeController(
    context: Context,
) {
    private val prefs =
        context.applicationContext.getSharedPreferences("sso_theme", Context.MODE_PRIVATE)
    private val key = "dark"

    var dark by mutableStateOf(initialValue(context))
        private set

    fun toggle() {
        dark = !dark
        prefs.edit().putBoolean(key, dark).apply()
    }

    private fun initialValue(context: Context): Boolean =
        prefs
            .let { p -> if (p.contains(key)) p.getBoolean(key, false) else systemPrefersDark(context) }

    private fun systemPrefersDark(context: Context): Boolean =
        (
            context.applicationContext.resources.configuration.uiMode and
                Configuration.UI_MODE_NIGHT_MASK
        ) == Configuration.UI_MODE_NIGHT_YES
}
