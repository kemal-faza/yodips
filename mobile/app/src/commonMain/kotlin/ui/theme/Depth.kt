package ac.undip.sso.ui.theme

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Card
import androidx.compose.material3.CardColors
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

/**
 * Satu model cahaya untuk seluruh UI: cahaya datang dari ATAS, bayangan jatuh
 * ke bawah.
 *
 * Setiap permukaan terangkat memakai DUA lapisan bayangan — kontak (rapat,
 * membuat objek terlihat menempel di permukaannya) dan ambien (lebar, memberi
 * jarak). Satu lapisan selalu terbaca datar: objeknya entah menempel tanpa
 * jarak, atau mengambang tanpa kontak. Ditambah [appBevel], tepinya terbaca
 * sebagai sisi objek bervolume, bukan potongan warna.
 */
data class AppElevation(
    /** Bayangan kontak, rapat ke tepi objek. */
    val contact: Dp,
    /** Bayangan ambien, seberapa tinggi objek mengambang. */
    val ambient: Dp,
) {
    /** Objek yang ditekan turun mendekati permukaan: kontak naik, ambien mengecil. */
    fun pressed(): AppElevation = AppElevation(contact + 1.dp, ambient * 0.4f)

    companion object {
        /** Menempel di permukaan, tanpa bayangan. Untuk isian, bukan objek. */
        val Flat = AppElevation(0.dp, 0.dp)

        /** Objek diam: kartu konten, kartu statistik. */
        val Raised = AppElevation(1.dp, 5.dp)

        /** Setingkat lebih atas: kartu menu yang bisa ditekan, pill, kalender. */
        val Lifted = AppElevation(2.dp, 12.dp)

        /** Mengambang di atas segalanya: FAB, dialog, chrome yang menempel. */
        val Floating = AppElevation(4.dp, 24.dp)
    }
}

/**
 * Warna permukaan yang terangkat. Aturannya satu dan berlaku di kedua tema:
 * objek yang terangkat menangkap lebih banyak cahaya, jadi permukaannya harus
 * LEBIH TERANG daripada halaman di belakangnya.
 *
 * Tema terang: putih di atas halaman abu-abu (#F7F7F7). Tema gelap: abu
 * terang di atas halaman hampir hitam (#121212) — di tema gelap inilah satu-
 * satunya pemisah yang benar-benar terbaca, karena bayangan hitam di atas latar
 * gelap nyaris tidak punya ruang untuk menggelap.
 */
@Composable
fun raisedSurfaceColor(): Color =
    if (isDarkTheme()) MaterialTheme.colorScheme.surfaceContainerHigh else Color.White

/** [CardColors] untuk permukaan terangkat; dipakai [AppCard] dan permukaan lain. */
@Composable
fun appCardColors(container: Color = raisedSurfaceColor()): CardColors =
    CardDefaults.cardColors(containerColor = container)

/**
 * Bayangan berlapis untuk permukaan apa pun. Dipasang SEBELUM background —
 * bayangan digambar di belakang isi. `clip` sengaja `false` supaya isi yang
 * memang keluar dari batas (mis. FAB di bottom bar) tidak terpotong.
 */
@Composable
fun Modifier.appDepth(
    level: AppElevation,
    shape: Shape = RectangleShape,
    pressed: Boolean = false,
): Modifier {
    if (level == AppElevation.Flat) return this
    val effective = if (pressed) level.pressed() else level
    val dark = isDarkTheme()
    // Di tema gelap bayangan hitam nyaris tidak terbaca di atas latar gelap,
    // jadi jaraknya ditambah dan bayangannya digambar sendiri (lihat di bawah).
    val ambient = if (dark) effective.ambient * 1.6f else effective.ambient
    return this
        .shadow(effective.contact, shape, clip = false)
        .shadow(ambient, shape, clip = false)
        .drawBehind {
            if (!dark) return@drawBehind
            // Bayangan versi tema gelap, digambar dengan lapisan-lapisan bentuk
            // yang sama dengan objeknya (bukan persegi) supaya tidak ada batas
            // kotak yang terlihat di sekitar kartu bulat/sudut membulat.
            val path = shape.toPath(size, layoutDirection, this)
            val haze = 16.dp.toPx()
            val steps = 10
            val perLayer = 0.5f / steps
            // Cahaya dari atas: seluruh kabut digeser turun, jadi sisi bawah
            // dapat bayangan paling tebal dan sisi atas paling tipis.
            translate(top = 3.dp.toPx()) {
                for (layer in steps downTo 1) {
                    // `Stroke` menggambar terpusat di garis bentuk, jadi separuh
                    // ke dalam (tertutup objeknya) dan separuh ke luar. Lapisan
                    // terluar paling tipis karena tidak ditumpuk lapisan lain.
                    drawPath(
                        path = path,
                        color = Color.Black.copy(alpha = perLayer),
                        style = Stroke(width = haze * 2f * layer / steps),
                    )
                }
            }
        }
}

/** Bentuk apa pun (persegi, membulat, lingkaran) → [Path] agar bisa digambar berlapis. */
private fun Shape.toPath(
    size: Size,
    layoutDirection: LayoutDirection,
    density: Density,
): Path = when (val outline = createOutline(size, layoutDirection, density)) {
    is Outline.Rectangle -> Path().apply { addRect(outline.rect) }
    is Outline.Rounded -> Path().apply { addRoundRect(outline.roundRect) }
    is Outline.Generic -> outline.path
}

/**
 * Bayangan yang dijatuhkan chrome yang menempel di dasar layar ke konten di
 * ATASNYA. `Modifier.shadow` hanya menggelapkan sisi bawah objek, padahal
 * bottom bar harus terbaca mengambang di atas halaman yang men-scroll.
 */
@Composable
fun Modifier.appCastAbove(height: Dp = 12.dp): Modifier {
    val shadow = if (isDarkTheme()) {
        Color.Black.copy(alpha = 0.55f)
    } else {
        Color.Black.copy(alpha = 0.13f)
    }
    return this.drawBehind {
        val cast = height.toPx()
        // Gradien digambar DI LUAR batas node (di atas bottom bar). Brush di
        // luar batas tidak mewarisi ruang koordinat node, jadi rentangnya
        // disebut eksplisit: dari -cast (transparan) sampai 0 (warna bayangan).
        drawRect(
            brush = Brush.verticalGradient(
                colors = listOf(Color.Transparent, shadow),
                startY = -cast,
                endY = 0f,
            ),
            topLeft = Offset(0f, -cast),
            size = Size(size.width, cast),
        )
    }
}

/**
 * Kartu standar aplikasi: kartu Material 3 dengan bayangan berlapis. `Card`
 * mentah tidak punya bayangan sama sekali (elevasi M3 default 0), jadi semua
 * permukaan kartu memakai ini supaya kedalamannya konsisten.
 */
@Composable
fun AppCard(
    modifier: Modifier = Modifier,
    level: AppElevation = AppElevation.Raised,
    shape: Shape = CardDefaults.shape,
    colors: CardColors = appCardColors(),
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()
    val depth = modifier.fillMaxWidth().appDepth(level, shape, pressed = isPressed)
    if (onClick != null) {
        Card(
            onClick = onClick,
            modifier = depth,
            shape = shape,
            colors = colors,
            elevation = CardDefaults.cardElevation(0.dp),
            interactionSource = interactionSource,
            content = content,
        )
    } else {
        Card(
            modifier = depth,
            shape = shape,
            colors = colors,
            elevation = CardDefaults.cardElevation(0.dp),
            content = content,
        )
    }
}
