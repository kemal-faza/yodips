package ac.undip.sso.ui.theme

import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Card
import androidx.compose.material3.CardColors
import androidx.compose.material3.CardDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.unit.Dp
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

/** Warna tepi: cincin luar, kilau bibir atas, bibir bawah yang menggelap. */
private class DepthPalette(
    val ring: Color,
    val rim: Color,
    val lip: Color,
)

@Composable
private fun depthPalette(): DepthPalette =
    if (isDarkTheme()) {
        DepthPalette(
            ring = Color.White.copy(alpha = 0.10f),
            rim = Color.White.copy(alpha = 0.16f),
            lip = Color.Black.copy(alpha = 0.32f),
        )
    } else {
        DepthPalette(
            ring = Color.Black.copy(alpha = 0.06f),
            rim = Color.White.copy(alpha = 0.90f),
            lip = Color.Black.copy(alpha = 0.06f),
        )
    }

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
    // Di tema gelap bayangan hitam hampir tidak terbaca di atas latar gelap,
    // jadi jaraknya ditambah; sisi terangnya dipikul `appBevel`.
    val ambient = if (isDarkTheme()) effective.ambient * 1.3f else effective.ambient
    return this
        .shadow(effective.contact, shape, clip = false)
        .shadow(ambient, shape, clip = false)
}

/**
 * Tepi objek: cincin tipis + kilau bibir atas + bibir bawah menggelap.
 * Dipasang SETELAH background supaya tergambar di atasnya, tapi sebelum isi
 * supaya teks tidak tertimpa. Pemanggil yang bentuknya membulat harus sudah
 * memakai `clip(shape)` lebih dulu agar kilaunya tidak menyembul di sudut.
 * [ring] dimatikan untuk elemen selebar layar, yang tepi kiri-kanannya tidak
 * akan pernah terlihat.
 */
@Composable
fun Modifier.appBevel(
    shape: Shape = RectangleShape,
    ring: Boolean = true,
): Modifier {
    val palette = depthPalette()
    return this
        .then(if (ring) Modifier.border(1.dp, palette.ring, shape) else Modifier)
        .drawBehind { drawBevel(palette) }
}

private fun DrawScope.drawBevel(palette: DepthPalette) {
    val rimHeight = 2.dp.toPx()
    val lipHeight = 3.dp.toPx()
    drawRect(
        brush = Brush.verticalGradient(listOf(palette.rim, Color.Transparent)),
        topLeft = Offset.Zero,
        size = Size(size.width, rimHeight),
    )
    drawRect(
        brush = Brush.verticalGradient(listOf(Color.Transparent, palette.lip)),
        topLeft = Offset(0f, size.height - lipHeight),
        size = Size(size.width, lipHeight),
    )
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
 * Kartu standar aplikasi: kartu Material 3 dengan bayangan berlapis dan tepi
 * bercahaya. `Card` mentah tidak punya bayangan sama sekali (elevasi M3 default
 * 0), jadi semua permukaan kartu memakai ini supaya kedalamannya konsisten.
 */
@Composable
fun AppCard(
    modifier: Modifier = Modifier,
    level: AppElevation = AppElevation.Raised,
    shape: Shape = CardDefaults.shape,
    colors: CardColors = CardDefaults.cardColors(),
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()
    Box(modifier = modifier.appDepth(level, shape, pressed = isPressed)) {
        if (onClick != null) {
            Card(
                onClick = onClick,
                modifier = Modifier.fillMaxWidth(),
                shape = shape,
                colors = colors,
                elevation = CardDefaults.cardElevation(0.dp),
                interactionSource = interactionSource,
                content = content,
            )
        } else {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = shape,
                colors = colors,
                elevation = CardDefaults.cardElevation(0.dp),
                content = content,
            )
        }
        // Overlay tepi digambar setelah kartu, jadi cincin dan kilaunya tidak
        // tertimpa warna container kartu.
        Box(
            Modifier
                .matchParentSize()
                .clip(shape)
                .appBevel(shape),
        )
    }
}
