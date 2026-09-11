package ac.undip.sso.core.session

import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * AES-GCM with a random per-encryption IV, Base64(iv || ciphertext) framed.
 * This is what protects the JWT + session cookies at rest in dataStore. The
 * crypto itself is pure JVM (no Android deps) so round-trip, tamper and
 * wrong-key behaviour are unit-testable here; KeystoreTokenCipher only swaps in
 * the KeyStore-backed secret key on-device.
 */
class TokenCipherTest {
    private fun key(byte: Int = 0x42): SecretKey =
        SecretKeySpec(ByteArray(32) { byte.toByte() }, "AES")

    @Test
    fun `roundtrip returns the original value and encrypts it`() {
        val cipher = AesGcmCipher(key())

        val enc = cipher.encrypt("jwt-payload")

        assertNotEquals("jwt-payload", enc)
        assertEquals("jwt-payload", cipher.decrypt(enc))
    }

    @Test
    fun `each encryption uses a distinct IV so equal plaintexts differ`() {
        val cipher = AesGcmCipher(key())

        val a = cipher.encrypt("same-value")
        val b = cipher.encrypt("same-value")

        assertNotEquals(a, b)
    }

    @Test
    fun `tampered ciphertext fails GCM auth and returns null`() {
        val cipher = AesGcmCipher(key())
        val enc = cipher.encrypt("secret")
        val tampered = enc.dropLast(1) + if (enc.last() == 'A') 'B' else 'A'

        assertNull(cipher.decrypt(tampered))
    }

    @Test
    fun `a different key cannot decrypt the ciphertext`() {
        val enc = AesGcmCipher(key(0x01)).encrypt("secret")

        assertNull(AesGcmCipher(key(0x02)).decrypt(enc))
    }

    @Test
    fun `non-base64 input returns null instead of crashing`() {
        assertNull(AesGcmCipher(key()).decrypt("not base64!!!"))
    }
}