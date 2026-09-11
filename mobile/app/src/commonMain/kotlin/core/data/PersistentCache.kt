package ac.undip.sso.core.data

import ac.undip.sso.core.session.TokenCipher

/**
 * On-device disk backing for successful repo results, keyed by the same cache
 * key the in-memory [InMemoryDataCache] uses. Purpose: keep a screen instantly
 * usable after a process restart / app relaunch, when the in-memory cache is
 * empty. The repository restores from here on a cold (memory) miss and then
 * refreshes in the background.
 *
 * Storage only deals in already-serialized JSON strings + a capture timestamp;
 * serializing/de-serializing the concrete type (and whether it is a List etc.)
 * is the repository's job, so this stays generic and free of Android-JVM code.
 */
interface PersistentCache {
    data class Entry(
        val json: String,
        val fetchedAt: Long,
    )

    /** Return null when nothing was persisted for [key]. */
    suspend fun load(key: String): Entry?

    suspend fun save(
        key: String,
        json: String,
        fetchedAt: Long,
    )
}

/** No disk backing — unit tests use this so nothing touches DataStore. */
object NoOpPersistentCache : PersistentCache {
    override suspend fun load(key: String): PersistentCache.Entry? = null

    override suspend fun save(
        key: String,
        json: String,
        fetchedAt: Long,
    ) = Unit
}

/**
 * Decorator that encrypts every cache value at rest before handing it to the
 * wrapped [PersistentCache], and decrypts on read. The on-disk profile (PII —
 * NIK, phone, DOB, etc.) must never survive as plaintext, matching the already-
 * encrypted [ac.undip.sso.core.session.TokenStore]. Fail-closed: a value that
 * cannot be decrypted (tampered / wrong key / legacy plaintext) is treated as a
 * cache miss (null) so the screen re-fetches instead of trusting unverifiable data.
 */
class EncryptedPersistentCache(
    private val cipher: TokenCipher,
    private val delegate: PersistentCache,
) : PersistentCache {
    override suspend fun load(key: String): PersistentCache.Entry? {
        val entry = delegate.load(key) ?: return null
        val plain = cipher.decrypt(entry.json) ?: return null
        return PersistentCache.Entry(plain, entry.fetchedAt)
    }

    override suspend fun save(
        key: String,
        json: String,
        fetchedAt: Long,
    ) {
        delegate.save(key, cipher.encrypt(json), fetchedAt)
    }
}
