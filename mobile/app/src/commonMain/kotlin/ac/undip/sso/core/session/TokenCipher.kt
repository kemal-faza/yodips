package ac.undip.sso.core.session

/**
 * Encrypts (+ decrypts) sensitive values — the JWT and the captured SSO/Kulon/
 * SIAP session cookies — before they are persisted in DataStore, so nothing
 * survives on disk as plaintext. This is the baseline that makes a long-lived
 * backend session (and later a refresh/rotation scheme) safe on-device.
 */
interface TokenCipher {
    fun encrypt(plain: String): String
    /** Returns null when [encoded] is not a valid ciphertext under this key
     *  (tampered, wrong key, or legacy plaintext) — never throws. */
    fun decrypt(encoded: String): String?
}
