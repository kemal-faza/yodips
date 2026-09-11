package ac.undip.sso

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers

internal actual fun nowMs(): Long = System.currentTimeMillis()
internal actual fun uptimeMs(): Long = android.os.SystemClock.uptimeMillis()
internal actual val ioDispatcher: CoroutineDispatcher = Dispatchers.IO
actual val appBaseUrl: String = ac.undip.sso.BuildConfig.BASE_URL

/** URLEncoder escapes `#` → `%23`; encodeURIComponent semantics per RFC 3986
 *  path segment (Navigation route needs the fragment delimiter escaped). */
internal actual fun encodeUriComponent(value: String): String =
    java.net.URLEncoder.encode(value, "UTF-8")
        .replace("+", "%20")
        .replace("%2F", "/") // keep slashes readable; only fragment-breaking chars matter
