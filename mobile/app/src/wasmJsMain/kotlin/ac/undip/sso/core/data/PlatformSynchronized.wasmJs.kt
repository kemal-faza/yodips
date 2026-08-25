package ac.undip.sso.core.data

/**
 * wasmJs: single-threaded, so synchronization is a no-op.
 * The block is executed directly without any lock.
 */
internal actual fun <R> platformSynchronized(lock: Any, block: () -> R): R = block()
