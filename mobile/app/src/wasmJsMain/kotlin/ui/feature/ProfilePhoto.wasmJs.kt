package ac.undip.sso.ui.feature

import androidx.compose.runtime.Composable
import coil3.ImageLoader
import coil3.SingletonImageLoader
import coil3.compose.LocalPlatformContext

@Composable
internal actual fun rememberProfileImageLoader(): ImageLoader =
    // Coil 3.4 punya varian -wasm-js; default SingletonImageLoader me-wire
    // Ktor network fetcher dari coil-network-ktor3 (auto-registered). Jadi cukup
    // ambil loader dengan PlatformContext wasm — tidak perlu eject components.
    SingletonImageLoader.get(LocalPlatformContext.current)
