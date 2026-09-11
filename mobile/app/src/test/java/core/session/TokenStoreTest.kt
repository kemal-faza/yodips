package ac.undip.sso.core.session

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import java.io.File
import javax.crypto.spec.SecretKeySpec
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * TokenStore persists the JWT + session cookies through a TokenCipher so
 * nothing sensitive survives on disk as plaintext. DataStore runs on the JVM
 * (temp file), so storage + encryption are integration-tested here; only the
 * KeyStore-backed token key is device-specific (KeystoreTokenCipher).
 *
 * DataStore forbids two active instances for one file, so each test builds a
 * single [DataStore] and reaches TokenStore *and* the raw on-disk value through
 * that same instance.
 */
class TokenStoreTest {
    private fun dataStore(file: File): DataStore<Preferences> =
        PreferenceDataStoreFactory.create(
            scope = CoroutineScope(Dispatchers.IO + SupervisorJob()),
            produceFile = { file },
        )

    private fun tokenStore(ds: DataStore<Preferences>): TokenStore =
        TokenStore(
            ds,
            AesGcmCipher(SecretKeySpec(ByteArray(32) { 1 }, "AES")),
        )

    @Test
    fun `save then read round-trips token and cookies through encryption`() = runBlocking {
        val ds = dataStore(File.createTempFile("tok", ".preferences_pb"))
        val s = tokenStore(ds)

        s.save("jwt-A", "siap-1", "kulon-2")

        assertEquals("jwt-A", s.currentToken())
        assertEquals("siap-1", s.siapCookie.first())
        assertEquals("kulon-2", s.kulonCookie.first())
    }

    @Test
    fun `nothing is persisted in plaintext`() = runBlocking {
        val ds = dataStore(File.createTempFile("tok", ".preferences_pb"))
        val s = tokenStore(ds)
        s.save("jwt-secret", null, null)

        val raw = ds.data.first()[stringPreferencesKey("jwt")]

        assertNotNull(raw) // it WAS persisted
        assertNotEquals("jwt-secret", raw) // but not as plaintext
    }

    @Test
    fun `clear empties every stored value`() = runBlocking {
        val ds = dataStore(File.createTempFile("tok", ".preferences_pb"))
        val s = tokenStore(ds)
        s.save("jwt-A", "siap-1", "kulon-2")

        s.clear()

        assertNull(s.currentToken())
        assertNull(s.siapCookie.first())
        assertNull(s.kulonCookie.first())
    }

    @Test
    fun `absent value returns null`() = runBlocking {
        val ds = dataStore(File.createTempFile("tok", ".preferences_pb"))
        assertNull(tokenStore(ds).currentToken())
    }

    @Test
    fun `legacy plaintext value is treated as invalid and returns null`() = runBlocking {
        // Simulates pre-encryption data: raw plaintext written under the jwt
        // key on disk. The cipher cannot decrypt it -> TokenStore must refuse
        // it (force re-login) rather than trust a plaintext credential.
        val ds = dataStore(File.createTempFile("tok", ".preferences_pb"))
        ds.edit { it[stringPreferencesKey("jwt")] = "legacy-plain-jwt" }

        val s = tokenStore(ds)

        assertNull(s.currentToken())
    }
}