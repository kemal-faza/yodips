package ac.undip.sso.core.data

import ac.undip.sso.core.session.AesGcmCipher
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Test
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

class EncryptedPersistentCacheTest {

    private class MemoryPersistentCache : PersistentCache {
        private val map = HashMap<String, PersistentCache.Entry>()
        override suspend fun load(key: String): PersistentCache.Entry? = map[key]
        override suspend fun save(key: String, json: String, fetchedAt: Long) {
            map[key] = PersistentCache.Entry(json, fetchedAt)
        }
    }

    private fun fakeKey(): SecretKey =
        KeyGenerator.getInstance("AES").run { init(256); generateKey() }

    @Test
    fun roundTripsEncryptedValue() = runBlocking {
        val delegate = MemoryPersistentCache()
        val cache = EncryptedPersistentCache(AesGcmCipher(fakeKey()), delegate)

        cache.save("profile", """{"nik":"123"}""", 100L)
        val out = cache.load("profile")

        assertNotNull(out)
        assertEquals("""{"nik":"123"}""", out!!.json)
        assertEquals(100L, out.fetchedAt)
        // The delegate must NOT hold the plaintext — it holds ciphertext only.
        assertNotEquals("""{"nik":"123"}""", delegate.load("profile")!!.json)
    }

    @Test
    fun returnsNullWhenPlaintextLeakedToDelegate() = runBlocking {
        // Fail-closed: a value stored plaintext (e.g. before encryption was added)
        // can't be decrypted by the cipher → treated as a cache miss.
        val delegate = MemoryPersistentCache()
        delegate.save("profile", """{"nik":"123"}""", 50L)

        val cache = EncryptedPersistentCache(AesGcmCipher(fakeKey()), delegate)
        assertNull(cache.load("profile"))
    }

    @Test
    fun returnsNullWhenMiss() = runBlocking {
        val cache = EncryptedPersistentCache(AesGcmCipher(fakeKey()), MemoryPersistentCache())
        assertNull(cache.load("absent"))
    }
}