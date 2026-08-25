package ac.undip.sso.core.data

/**
 * JVM/Android: delegates to the real `kotlin.synchronized` for thread safety.
 */
internal actual fun <R> platformSynchronized(lock: Any, block: () -> R): R =
    synchronized(lock, block)
