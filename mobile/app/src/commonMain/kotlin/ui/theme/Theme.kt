package ac.undip.sso.ui.theme

import ac.undip.sso.ui.theme.Res // generated accessor (module :app)
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.Font

// ===== Tokens mirrored from web/DESIGN.md (web/src/assets/css/main.css) =====
// Primary/brand (unchanged in light & dark).
val Primary = Color(0xFF01637E)
val PrimaryForeground = Color(0xFFFFFFFF)

// Neutrals - light (hsl rounded).
val BgLight = Color(0xFFF7F7F7) // 0 0% 97%
val FgLight = Color(0xFF0A0A0A) // 0 0% 3.9%
val CardLight = Color(0xFFFFFFFF)
val MutedBgLight = Color(0xFFF2F2F2) // 0 0% 95%
val MutedFgLight = Color(0xFF737373) // 0 0% 45.1%
val BorderLight = Color(0xFFE5E5E5) // 0 0% 89.8%
val RingLight = Color(0xFF0A0A0A) // --ring = --foreground (0 0% 3.9%)

// Neutrals - dark.
val BgDark = Color(0xFF121212) // 0 0% 7%
val FgDark = Color(0xFFFAFAFA) // 0 0% 98%
val CardDark = Color(0xFF1F1F1F) // 0 0% 12%
val MutedBgDark = Color(0xFF282828) // 0 0% 15.5%
val MutedFgDark = Color(0xFFA3A3A3) // 0 0% 63.9%
val BorderDark = Color(0xFF2E2E2E) // 0 0% 18%
val RingDark = Color(0xFFD4D4D4) // --ring 0 0% 83.1%

// Semantik.
val Warn = Color(0xFFF59E0B)
val Gold = Color(0xFFFFC107)
val Success = Color(0xFF16A34A)
val DangerLight = Color(0xFFDC2626)
val DangerDark = Color(0xFFF87171)

// Container / tinted roles. The web neutrals are all 0-saturation grays and the
// brand is teal, so every Material 3 role that we don't set explicitly must be
// overridden here — otherwise lightColorScheme()/darkColorScheme() fall back to
// the baseline PURPLE palette (that's what made cards/avatar look purplish).
val PrimaryContainerLight = Color(0xFFDFF1F6) // teal-100 (brand tint, not purple)
val OnPrimaryContainerLight = Color(0xFF04313D) // dark teal text
val PrimaryContainerDark = Color(0xFF0E3A4A) // teal-900
val OnPrimaryContainerDark = Color(0xFFB9E2EE) // light teal text
val SurfaceContainerLowestL = Color(0xFFFFFFFF)
val SurfaceContainerLowL = Color(0xFFFFFFFF) // == card
val SurfaceContainerL = Color(0xFFF3F3F3)
val SurfaceContainerHighL = Color(0xFFEFEFEF)
val SurfaceContainerHighestL = Color(0xFFE9E9E9)
val SurfaceContainerLowestD = Color(0xFF0D0D0D)
val SurfaceContainerLowD = Color(0xFF1A1A1A)
val SurfaceContainerD = Color(0xFF242424)
val SurfaceContainerHighD = Color(0xFF2A2A2A)
val SurfaceContainerHighestD = Color(0xFF303030)

private val LightColors =
    lightColorScheme(
        primary = Primary,
        onPrimary = PrimaryForeground,
        primaryContainer = PrimaryContainerLight,
        onPrimaryContainer = OnPrimaryContainerLight,
        secondary = MutedBgLight,
        onSecondary = FgLight,
        secondaryContainer = MutedBgLight,
        onSecondaryContainer = FgLight,
        tertiary = MutedBgLight,
        onTertiary = FgLight,
        tertiaryContainer = SurfaceContainerHighL,
        onTertiaryContainer = FgLight,
        background = BgLight,
        onBackground = FgLight,
        surface = CardLight,
        onSurface = FgLight,
        surfaceVariant = MutedBgLight,
        onSurfaceVariant = MutedFgLight,
        surfaceTint = Primary,
        surfaceContainerLowest = SurfaceContainerLowestL,
        surfaceContainerLow = SurfaceContainerLowL,
        surfaceContainer = SurfaceContainerL,
        surfaceContainerHigh = SurfaceContainerHighL,
        surfaceContainerHighest = SurfaceContainerHighestL,
        inverseSurface = FgLight,
        inverseOnSurface = BgLight,
        inversePrimary = PrimaryContainerDark,
        outline = BorderLight,
        outlineVariant = SurfaceContainerHighL,
        error = DangerLight,
        onError = PrimaryForeground,
        errorContainer = Color(0xFFFCE4E4),
        onErrorContainer = Color(0xFF7A1515),
    )

private val DarkColors =
    darkColorScheme(
        primary = Primary,
        onPrimary = PrimaryForeground,
        primaryContainer = PrimaryContainerDark,
        onPrimaryContainer = OnPrimaryContainerDark,
        secondary = MutedBgDark,
        onSecondary = FgDark,
        secondaryContainer = MutedBgDark,
        onSecondaryContainer = FgDark,
        tertiary = MutedBgDark,
        onTertiary = FgDark,
        tertiaryContainer = SurfaceContainerHighD,
        onTertiaryContainer = FgDark,
        background = BgDark,
        onBackground = FgDark,
        surface = CardDark,
        onSurface = FgDark,
        surfaceVariant = MutedBgDark,
        onSurfaceVariant = MutedFgDark,
        surfaceTint = Primary,
        surfaceContainerLowest = SurfaceContainerLowestD,
        surfaceContainerLow = SurfaceContainerLowD,
        surfaceContainer = SurfaceContainerD,
        surfaceContainerHigh = SurfaceContainerHighD,
        surfaceContainerHighest = SurfaceContainerHighestD,
        inverseSurface = BgLight,
        inverseOnSurface = FgLight,
        inversePrimary = PrimaryContainerLight,
        outline = BorderDark,
        outlineVariant = SurfaceContainerHighD,
        error = DangerDark,
        onError = FgDark,
        errorContainer = Color(0xFF401719),
        onErrorContainer = Color(0xFFF9CFCF),
    )

// Radius follows web --radius scale (0.5rem = 8dp; -sm=-4px, -md=-2px, -xl=+4px).
private val AppShapes =
    Shapes(
        extraSmall = RoundedCornerShape(4.dp), // --radius-sm
        small = RoundedCornerShape(6.dp), // --radius-md
        medium = RoundedCornerShape(8.dp), // --radius = 0.5rem
        large = RoundedCornerShape(12.dp), // --radius-xl
        extraLarge = RoundedCornerShape(16.dp), // mobile-only larger radius
    )

// ===== Geist (mirrors web font stack: Geist 400/500/600/700) =====
// Embedded static TTFs (SIL OFL) via Compose Multiplatform resources. A single
// FontFamily of four weights lets Material3 pick the right face for each
// TextStyle/fontWeight. CMP's resource-backed Font() is @Composable (unlike the
// old androidx Font(resId)), so the family is built inside composition.
@Composable
private fun geistFontFamily(): FontFamily =
    FontFamily(
        Font(Res.font.geist_regular, weight = FontWeight.Normal),
        Font(Res.font.geist_medium, weight = FontWeight.Medium),
        Font(Res.font.geist_semibold, weight = FontWeight.SemiBold),
        Font(Res.font.geist_bold, weight = FontWeight.Bold),
    )

// Web uses Geist across all weights; keep each face's own size/style/weight but
// point the family at Geist so the whole UI follows the brand typeface.
@Composable
private fun appTypography(): Typography {
    val geist = geistFontFamily()
    fun rewrite(ts: TextStyle) = ts.copy(fontFamily = geist)
    return Typography().run {
        Typography(
            displayLarge = rewrite(displayLarge),
            displayMedium = rewrite(displayMedium),
            displaySmall = rewrite(displaySmall),
            headlineLarge = rewrite(headlineLarge),
            headlineMedium = rewrite(headlineMedium),
            headlineSmall = rewrite(headlineSmall),
            titleLarge = rewrite(titleLarge),
            titleMedium = rewrite(titleMedium),
            titleSmall = rewrite(titleSmall),
            bodyLarge = rewrite(bodyLarge),
            bodyMedium = rewrite(bodyMedium),
            bodySmall = rewrite(bodySmall),
            labelLarge = rewrite(labelLarge),
            labelMedium = rewrite(labelMedium),
            labelSmall = rewrite(labelSmall),
        )
    }
}

/** True when the active Material color scheme is the dark one. */
val LocalIsDark = staticCompositionLocalOf { false }

@Composable
fun isDarkTheme(): Boolean = LocalIsDark.current

/**
 * Foreground accent for text/icons: primary teal in light, neutral foreground in
 * dark. Teal (`#01637E`) has poor contrast on the dark background, so dark mode
 * keeps primary exclusively for element backgrounds (buttons, FAB, accent bars)
 * and renders text/icons in the neutral foreground instead.
 */
@Composable
fun accentForeground(): Color = if (isDarkTheme()) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.primary

@Composable
fun UndipSSOTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(LocalIsDark provides darkTheme) {
        MaterialTheme(
            colorScheme = if (darkTheme) DarkColors else LightColors,
            shapes = AppShapes,
            typography = appTypography(),
            content = content,
        )
    }
}
