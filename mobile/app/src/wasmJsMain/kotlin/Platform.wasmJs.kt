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

@JsFun("(v) => encodeURIComponent(v)")
private external fun jsEncodeUriComponent(value: String): String

internal actual fun encodeUriComponent(value: String): String = jsEncodeUriComponent(value)

@JsFun("() => document.visibilityState === 'visible'")
internal external fun jsDocumentVisible(): Boolean

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun(
    "(cb) => {" +
        "var prev = window.__ydVisHandler;" +
        "if (prev) document.removeEventListener('visibilitychange', prev);" +
        "var fn = function(){ cb(document.visibilityState === 'visible'); };" +
        "window.__ydVisHandler = fn;" +
        "document.addEventListener('visibilitychange', fn);" +
        "}",
)
internal external fun jsObserveVisibility(cb: (Boolean) -> Unit)

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun(
    "() => {" +
        "var h = window.__ydVisHandler;" +
        "if (h) { document.removeEventListener('visibilitychange', h); window.__ydVisHandler = null; }" +
        "}",
)
internal external fun jsRemoveVisibilityObserver()