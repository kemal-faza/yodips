package ac.undip.sso.core.data

/**
 * Platform-safe synchronized wrapper.
 * JVM: delegates to `kotlin.synchronized` (uses monitor).
 * wasmJs: no-op, since wasmJs is single-threaded.
 * js: same as wasmJs.
 */
internal expect fun <R> platformSynchronized(lock: Any, block: () -> R): R