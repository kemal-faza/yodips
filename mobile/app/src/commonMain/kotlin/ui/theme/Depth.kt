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
 * Tema gelap memakai aturan yang berbeda, karena bayangan di sana alat yang
 * salah: bayangan tidak bisa lebih gelap daripada latar yang sudah hampir
 * hitam, jadi kedalaman dipikul TANGGA LUMINANSI permukaan (canvas #121212 →
 * kartu lebih terang). Bayangan tema gelap ([shade]/[drop]/[shadeAlpha])
 * dikecilkan jadi bayangan kontak yang rapat dan tipis saja — bukan blob gelap.
 *
 * Rujukan: Material (dark theme pakai permukaan abu gelap, bukan hitam, supaya
 * elevasi terbaca) dan panduan dark-mode yang menyarankan naik 5–8% luminansi
 * per tingkat elevasi alih-alih drop shadow.
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
    /** Alpha kabut tema gelap tepat di tepi objek. */
    val shadeAlpha: Float,
) {
    /** Objek yang ditekan turun mendekati permukaan: bayangannya mengecil. */
    fun pressed(): AppElevation = AppElevation(
        contact = contact + 1.dp,
        ambient = ambient * 0.4f,
        shade = shade * 0.7f,
        drop = drop * 0.4f,
        shadeAlpha = shadeAlpha * 0.6f,
    )

    companion object {
        /** Menempel di permukaan, tanpa bayangan. Untuk isian, bukan objek. */
        val Flat = AppElevation(0.dp, 0.dp, 0.dp, 0.dp, 0f)

        /** Objek diam: kartu konten, kartu statistik. */
        val Raised = AppElevation(1.dp, 5.dp, shade = 4.dp, drop = 1.dp, shadeAlpha = 0.30f)

        /** Setingkat lebih atas: kartu menu yang bisa ditekan, pill, kalender. */
        val Lifted = AppElevation(2.dp, 12.dp, shade = 6.dp, drop = 2.dp, shadeAlpha = 0.35f)

        /**
         * Objek yang menonjol keluar dari permukaan lain — FAB di bottom bar,
         * dialog yang melayang di atas scrim. Perlakuan bayangannya sengaja
         * lebih tebal daripada kartu: bayangannya jatuh ke permukaan yang LEBIH
         * TERANG (bar), bukan ke halaman, jadi di situ bayangan memang terbaca.
         */
        val Floating = AppElevation(6.dp, 28.dp, shade = 16.dp, drop = 5.dp, shadeAlpha = 0.50f)
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
 *
 * @param haze kabut kontak tambahan yang hanya dipakai di tema gelap. Matikan
 *   untuk objek yang cukup dengan bayangan platform saja: objek yang bayangannya
 *   jatuh ke permukaan LEBIH TERANG (FAB di atas bottom bar) sudah terbaca tanpa
 *   tambahan, dan kabut justru mengubah karakternya jadi halo yang menyebar.
 */
@Composable
fun Modifier.appDepth(
    level: AppElevation,
    shape: Shape = RectangleShape,
    pressed: Boolean = false,
    haze: Boolean = true,
): Modifier {
    if (level == AppElevation.Flat) return this
    val effective = if (pressed) level.pressed() else level
    // Bayangan platform (ambient + spot) dipakai di KEDUA tema. Ini satu-satunya
    // API bayangan yang benar: bentuknya mengikuti objek, arahnya sesuai cahaya,
    // dan sisi ATAS objek ikut mendapat bayangan ambient — kabut buatan sendiri
    // tidak bisa memberi itu. Di tema gelap lapisan ini lemah (latar hampir
    // hitam tidak punya ruang untuk digelapkan), jadi ditambah kabut kontak.
    val platform = this
        .shadow(effective.contact, shape, clip = false)
        .shadow(effective.ambient, shape, clip = false)
    if (!isDarkTheme() || !haze) return platform
    // Kabut tambahan khusus tema gelap: "bayangan kontak" yang rapat di tepi
    // objek, karena bayangan platform di atas latar hampir hitam hampir tak
    // terlihat. Kedalaman tetap dipikul tangga luminansi permukaan (lihat
    // `raisedSurfaceColor`), kabut ini hanya menegaskan objeknya menempel.
    // `drawWithCache`: bentuk dan jarak dihitung sekali per ukuran, bukan tiap
    // frame saat daftar di-scroll.
    return platform.drawWithCache {
        val path = shape.toPath(size, layoutDirection, this)
        val colour = Color.Black.copy(alpha = 1f - (1f - effective.shadeAlpha).pow(1f / Layers))
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

/** Jumlah lapisan kabut tema gelap; makin banyak, gradasinya makin mulus. */
private const val Layers = 8

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
