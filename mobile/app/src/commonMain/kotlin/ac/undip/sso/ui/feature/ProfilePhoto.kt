package ac.undip.sso.ui.feature

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import coil3.ImageLoader
import coil3.compose.AsyncImage

/**
 * ImageLoader per-platform: Android = Coil default (network fetcher disertakan
 * otomatis); wasmJs = Coil dengan PlatformContext eksplisit (Coil 3.4 punya
 * varian -wasm-js, default loader me-wire Ktor fetcher dari coil-network-ktor3).
 * Di-eject sebagai expect/actual supaya tiap target mendapat konteks yang benar
 * — Coil butuh PlatformContext yang valid; tanpa ini foto bisa gagal diam-diam
 * di PWA (masalah paritas #3).
 */
@Composable
internal expect fun rememberProfileImageLoader(): ImageLoader

/**
 * Foto profil yang tampil di Android (Coil default) dan PWA (Coil wasm).
 * [url] harus absolute; bila kosong/null tidak menggambar apa pun (inisial
 * fallback tetap terlihat di bawahnya — lihat Avatar di ProfileScreen).
 */
@Composable
internal fun ProfilePhoto(
    url: String?,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
) {
    if (url.isNullOrBlank()) return
    AsyncImage(
        model = url,
        contentDescription = contentDescription,
        modifier = modifier,
        contentScale = ContentScale.Crop,
        imageLoader = rememberProfileImageLoader(),
    )
}
