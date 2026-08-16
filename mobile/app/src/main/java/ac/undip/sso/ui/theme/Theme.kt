package ac.undip.sso.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes

// ===== Tokens mirrored from web/DESIGN.md (web/src/assets/css/main.css) =====
// Primary/brand (unchanged in light & dark).
val Primary = Color(0xFF01637E)
val PrimaryForeground = Color(0xFFFFFFFF)

// Neutrals - light (hsl rounded).
val BgLight = Color(0xFFF7F7F7)        // 0 0% 97%
val FgLight = Color(0xFF0A0A0A)        // 0 0% 3.9%
val CardLight = Color(0xFFFFFFFF)
val MutedBgLight = Color(0xFFF2F2F2)   // 0 0% 95%
val MutedFgLight = Color(0xFF737373)   // 0 0% 45.1%
val BorderLight = Color(0xFFE5E5E5)    // 0 0% 89.8%

// Neutrals - dark.
val BgDark = Color(0xFF121212)         // 0 0% 7%
val FgDark = Color(0xFFFAFAFA)         // 0 0% 98%
val CardDark = Color(0xFF1F1F1F)       // 0 0% 12%
val MutedBgDark = Color(0xFF282828)    // 0 0% 15.5%
val MutedFgDark = Color(0xFFA3A3A3)    // 0 0% 63.9%
val BorderDark = Color(0xFF2E2E2E)     // 0 0% 18%

// Semantik.
val Warn = Color(0xFFF59E0B)
val Gold = Color(0xFFFFC107)
val Success = Color(0xFF16A34A)
val DangerLight = Color(0xFFDC2626)
val DangerDark = Color(0xFFF87171)

private val LightColors = lightColorScheme(
    primary = Primary,
    onPrimary = PrimaryForeground,
    background = BgLight,
    onBackground = FgLight,
    surface = CardLight,
    onSurface = FgLight,
    surfaceVariant = MutedBgLight,
    onSurfaceVariant = MutedFgLight,
    secondary = MutedBgLight,
    onSecondary = FgLight,
    outline = BorderLight,
    error = DangerLight,
    onError = Color.White,
)

private val DarkColors = darkColorScheme(
    primary = Primary,
    onPrimary = PrimaryForeground,
    background = BgDark,
    onBackground = FgDark,
    surface = CardDark,
    onSurface = FgDark,
    surfaceVariant = MutedBgDark,
    onSurfaceVariant = MutedFgDark,
    secondary = MutedBgDark,
    onSecondary = FgDark,
    outline = BorderDark,
    error = DangerDark,
    onError = FgDark,
)

private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp), // --radius-sm ~ (0.5rem - 4px)
    small = RoundedCornerShape(6.dp),
    medium = RoundedCornerShape(8.dp),      // --radius = 0.5rem ≈ 8dp
    large = RoundedCornerShape(12.dp),      // --radius-xl
    extraLarge = RoundedCornerShape(16.dp),
)

@Composable
fun UndipSSOTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        shapes = AppShapes,
        typography = androidx.compose.material3.Typography(),
        content = content,
    )
}
