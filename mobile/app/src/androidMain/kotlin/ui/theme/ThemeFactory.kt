package ac.undip.sso.ui.theme

import android.content.Context
import android.content.res.Configuration

/**
 * Android wiring for [ThemeController]: SharedPreferences persistence +
 * system night-mode detection — exactly the old ThemeController behavior.
 */
fun platformThemeController(context: Context): ThemeController {
    val prefs =
        context.applicationContext.getSharedPreferences("sso_theme", Context.MODE_PRIVATE)
    val key = "dark"
    return ThemeController(
        defaultDark = {
            if (prefs.contains(key)) {
                prefs.getBoolean(key, false)
            } else {
                (
                    context.applicationContext.resources.configuration.uiMode and
                        Configuration.UI_MODE_NIGHT_MASK
                    ) == Configuration.UI_MODE_NIGHT_YES
            }
        },
        persist = { prefs.edit().putBoolean(key, it).apply() },
    )
}
