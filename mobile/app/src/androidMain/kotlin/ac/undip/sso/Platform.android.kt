package ac.undip.sso

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers

internal actual fun nowMs(): Long = System.currentTimeMillis()
internal actual fun uptimeMs(): Long = android.os.SystemClock.uptimeMillis()
internal actual val ioDispatcher: CoroutineDispatcher = Dispatchers.IO
actual val appBaseUrl: String = ac.undip.sso.BuildConfig.BASE_URL
