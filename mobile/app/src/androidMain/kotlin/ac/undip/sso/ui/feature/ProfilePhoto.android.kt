package ac.undip.sso.ui.feature

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import coil3.ImageLoader
import coil3.SingletonImageLoader

@Composable
internal actual fun rememberProfileImageLoader(): ImageLoader =
    // Android: Coil default sudah menyertakan network fetcher (OkHttp/Ktor3).
    SingletonImageLoader.get(LocalContext.current)
