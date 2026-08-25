package ac.undip.sso.core.session

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * AES-256-GCM with a fresh random 12-byte IV per encryption, framed as
 * Base64(iv || ciphertext). GCM provides integrity (auth tag), so a tampered or
 * wrong-key ciphertext fails authentication and [decrypt] returns null.
 *
 * Pure JVM (uses `java.util.Base64`, available on Android API 26+ and the JVM),
 * which lets round-trip / tamper / wrong-key behaviour be unit-tested without a
 * device. [KeystoreTokenCipher] supplies the KeyStore-backed key on-device.
 */
class AesGcmCipher(
    private val key: SecretKey,
) : TokenCipher {
    override fun encrypt(plain: String): String {
        val cipher = GCM()
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val ciphertext = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.getEncoder().encodeToString(cipher.iv + ciphertext)
    }

    override fun decrypt(encoded: String): String? =
        try {
            val raw = Base64.getDecoder().decode(encoded)
            val iv = raw.copyOfRange(0, GCM_IV_LEN)
            val ciphertext = raw.copyOfRange(GCM_IV_LEN, raw.size)
            val cipher = GCM()
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        } catch (_: Exception) {
            null
        }

    private companion object {
        fun GCM(): Cipher = Cipher.getInstance("AES/GCM/NoPadding")
        const val GCM_IV_LEN = 12
        const val GCM_TAG_BITS = 128
    }
}

/**
 * On-device [TokenCipher] whose 256-bit AES key never leaves the Android
 * KeyStore hardware/software keystore (generated there, not exportable), so
 * even a rooted/backed-up device cannot exfiltrate the decryption key. The key
 * persists across app updates and survives until the app is uninstalled or the
 * keystore is cleared.
 */
class KeystoreTokenCipher(
    context: Context,
    keyAlias: String = DEFAULT_KEY_ALIAS,
) : TokenCipher {
    private val aes = AesGcmCipher(loadOrCreateKey(context, keyAlias))

    override fun encrypt(plain: String): String = aes.encrypt(plain)
    override fun decrypt(encoded: String): String? = aes.decrypt(encoded)

    private companion object {
        const val DEFAULT_KEY_ALIAS = "sso_token_key"

        fun loadOrCreateKey(context: Context, alias: String): SecretKey {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            (keyStore.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

            val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
            val specBuilder =
                KeyGenParameterSpec.Builder(
                    alias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                specBuilder.setUnlockedDeviceRequired(true)
            }
            generator.init(specBuilder.build())
            return generator.generateKey()
        }
    }
}

private const val ANDROID_KEYSTORE = "AndroidKeyStore"
