package ac.undip.sso.core.data

/** Metadata needed to decide which persisted cache entries to evict. */
data class CacheEntryMeta(
    val key: String,
    val fetchedAt: Long,
    val sizeBytes: Int,
)

/**
 * Pure capacity policy shared by the wasm IndexedDB cache and its JVM tests.
 * Eviction is oldest-first; ties are broken by key for deterministic tests.
 */
object CacheCapacityPolicy {
    const val MAX_ENTRY_BYTES: Int = 128 * 1024
    const val MAX_TOTAL_BYTES: Int = 2 * 1024 * 1024

    fun shouldStore(sizeBytes: Int): Boolean = sizeBytes in 1..MAX_ENTRY_BYTES

    fun trim(
        entries: List<CacheEntryMeta>,
        maxTotalBytes: Int = MAX_TOTAL_BYTES,
    ): Set<String> {
        var total = entries.sumOf { it.sizeBytes.toLong() }
        if (total <= maxTotalBytes) return emptySet()
        val delete = linkedSetOf<String>()
        for (entry in entries.sortedWith(compareBy<CacheEntryMeta> { it.fetchedAt }.thenBy { it.key })) {
            if (total <= maxTotalBytes) break
            delete += entry.key
            total -= entry.sizeBytes
        }
        return delete
    }
}
