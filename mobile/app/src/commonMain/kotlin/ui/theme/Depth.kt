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
import androidx.compose.ui.draw.drawWithCache
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
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * Satu model cahaya untuk seluruh UI: cahaya datang dari ATAS, bayangan jatuh
 * ke bawah.
 *
 * Tema terang memakai bayangan OS berlapis — kontak (rapat, membuat objek
 * terlihat menempel) + ambien (lebar, memberi jarak). Satu lapisan selalu
 * terbaca datar: objeknya entah menempel tanpa jarak, atau mengambang tanpa
 * kontak.
 *
 * Tema gelap memakai kabut yang digambar sendiri ([shade]/[drop]), meniru resep
 * `main.css` milik web: di sana bayangan tema gelap memakai alpha ~6x lebih
 * pekat daripada tema terang (`0 6px 22px rgba(0,0,0,.6)` vs `0 10px 28px
 * rgba(0,0,0,.13)`) — di atas latar hampir hitam, bayangan tipis tidak punya
 * cukup ruang untuk terbaca.
 */
data class AppElevation(
    /** Bayangan kontak OS (tema terang), rapat ke tepi objek. */
    val contact: Dp,
    /** Bayangan ambien OS (tema terang). */
    val ambient: Dp,
    /** Seberapa jauh kabut bayangan tema gelap menyebar dari tepi objek. */
    val shade: Dp,
    /** Pergeseran kabut ke bawah; cahaya datang dari atas. */
    val drop: Dp,
) {
    /** Objek yang ditekan turun mendekati permukaan: bayangannya mengecil. */
    fun pressed(): AppElevation = AppElevation(
        contact = contact + 1.dp,
        ambient = ambient * 0.4f,
        shade = shade * 0.7f,
        drop = drop * 0.4f,
    )

    companion object {
        /** Menempel di permukaan, tanpa bayangan. Untuk isian, bukan objek. */
        val Flat = AppElevation(0.dp, 0.dp, 0.dp, 0.dp)

        /** Objek diam: kartu konten, kartu statistik. Web: `0 2px 8px rgba(0,0,0,.45)`. */
        val Raised = AppElevation(1.dp, 5.dp, shade = 9.dp, drop = 2.dp)

        /** Setingkat lebih atas: kartu menu yang bisa ditekan, pill, kalender.
         *  Web: `0 6px 22px rgba(0,0,0,.6)`. */
        val Lifted = AppElevation(2.dp, 12.dp, shade = 20.dp, drop = 6.dp)

        /** Mengambang di atas segalanya: FAB, dialog, chrome yang menempel. */
        val Floating = AppElevation(4.dp, 24.dp, shade = 28.dp, drop = 8.dp)
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
    if (isDarkTheme()) {
        // Tema gelap: bayangan OS tidak bisa diatur alpha-nya (maksimum ~0.3)
        // dan di atas latar hampir hitam nyaris tak terbaca. Kabutnya digambar
        // sendiri mengikuti bentuk objek, dengan alpha tepi setara resep web
        // (`rgba(0,0,0,.6)`) dan profil yang lebih pekat di dekat tepi.
        // `drawWithCache`: bentuk dan jarak dihitung sekali per ukuran, bukan
        // tiap frame saat daftar di-scroll.
        return this.drawWithCache {
            val path = shape.toPath(size, layoutDirection, this)
            val colour = Color.Black.copy(alpha = 1f - (1f - EdgeAlpha).pow(1f / Layers))
            val spread = effective.shade.toPx()
            val drop = effective.drop.toPx()
            onDrawBehind {
                translate(top = drop) {
                    for (layer in Layers downTo 1) {
                        // Jari-jari memakai akar: lapisan menumpuk lebih rapat di
                        // dekat objek, jadi bayangannya turun tajam lalu menghilang
                        // (mirip sebaran Gaussian milik blur CSS), bukan landai.
                        val radius = spread * sqrt(layer.toFloat() / Layers)
                        // `Stroke` menggambar terpusat di garis bentuk: separuh ke
                        // dalam (tertutup objeknya), separuh ke luar.
                        drawPath(
                            path = path,
                            color = colour,
                            style = Stroke(width = radius * 2f),
                        )
                    }
                }
            }
        }
    }
    return this
        .shadow(effective.contact, shape, clip = false)
        .shadow(effective.ambient, shape, clip = false)
}

/** Alpha bayangan tepat di tepi objek pada tema gelap — `rgba(0,0,0,.6)` milik web. */
private const val EdgeAlpha = 0.6f

/** Jumlah lapisan kabut tema gelap; makin banyak, gradasinya makin mulus. */
private const val Layers = 12

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
