package ac.undip.sso.core.session

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertNull

/**
 * Exercises the actual wasmJs production [TokenStore] source set. The tiny
 * storage fake keeps the test independent from a browser's global
 * localStorage while still observing the real key removal and StateFlow reset.
 */
class TokenStoreWasmJsTest {
    private class FakeStorage(initialToken: String? = null) : WasmTokenStorage {
        private val values = mutableMapOf<String, String>()

        init {
            if (initialToken != null) values["sso_token"] = initialToken
        }

        override fun get(key: String): String? = values[key]

        override fun set(key: String, value: String) {
            values[key] = value
        }

        override fun remove(key: String) {
            values.remove(key)
        }
    }

    @Test
    fun `clearImmediately removes persisted key and resets production state`() = runTest {
        val storage = FakeStorage()
        val store = TokenStore(storage = storage)
        store.save("jwt-immediate", "ignored-siap", "ignored-kulon")

        store.clearImmediately()

        assertNull(storage.get("sso_token"))
        assertNull(store.currentToken())
        assertNull(store.siapCookie.first())
        assertNull(store.kulonCookie.first())
    }

    @Test
    fun `suspending clear removes persisted key and resets production state`() = runTest {
        val storage = FakeStorage()
        val store = TokenStore(storage = storage)
        store.save("jwt-suspend", null, null)

        store.clear()

        assertNull(storage.get("sso_token"))
        assertNull(store.currentToken())
        assertNull(store.siapCookie.first())
        assertNull(store.kulonCookie.first())
    }
}
