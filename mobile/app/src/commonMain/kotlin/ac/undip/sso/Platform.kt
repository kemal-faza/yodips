package ac.undip.sso

import kotlinx.coroutines.CoroutineDispatcher

/**
 * Tiny platform seams for logic that lives in commonMain. Behavior-freeze:
 * the Android actuals return exactly what the pre-migration code called.
 */
/** Wall-clock millis — was System.currentTimeMillis(). */
internal expect fun nowMs(): Long

/** Monotonic uptime millis — was android.os.SystemClock.uptimeMillis(). */
internal expect fun uptimeMs(): Long

/** Background IO pool — was Dispatchers.IO. */
internal expect val ioDispatcher: CoroutineDispatcher

/** Backend base URL baked per buildType — was BuildConfig.BASE_URL. */
expect val appBaseUrl: String

/**
 * URL-encode one path segment so values containing reserved chars (`#`, `/`)
 * survive Navigation Compose route parsing. Android → URLEncoder; wasm → JS
 * encodeURIComponent (kept identical for the fragment `#` → `%23`).
 */
internal expect fun encodeUriComponent(value: String): String
