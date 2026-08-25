package ac.undip.sso

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers

@JsFun("() => Date.now()")
private external fun jsNow(): Double

@JsFun("() => performance.now()")
private external fun jsPerfNow(): Double

@JsFun("() => window.location.hostname")
private external fun jsHostname(): String

internal actual fun nowMs(): Long = jsNow().toLong()

internal actual fun uptimeMs(): Long = jsPerfNow().toLong()

internal actual val ioDispatcher: CoroutineDispatcher = Dispatchers.Default

actual val appBaseUrl: String
    get() {
        val host = jsHostname()
        return if (host == "localhost" || host == "127.0.0.1") {
            "http://localhost:3000"
        } else {
            "https://backend.crunchy.my.id"
        }
    }