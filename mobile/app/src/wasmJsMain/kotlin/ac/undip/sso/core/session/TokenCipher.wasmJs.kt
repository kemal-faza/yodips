package ac.undip.sso.core.session

class WasmJsTokenCipher : TokenCipher {
    override fun encrypt(plain: String): String = plain
    override fun decrypt(encoded: String): String? = encoded
}