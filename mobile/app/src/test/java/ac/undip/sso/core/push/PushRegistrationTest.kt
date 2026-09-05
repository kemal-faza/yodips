package ac.undip.sso.core.push

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private class FakeOps : PushRegistration.Ops {
    val registered = mutableListOf<String>()
    val unregistered = mutableListOf<String>()
    var pending: String? = null
    var fcmToken: String? = "fcm-1"
    var registerOk = true

    override suspend fun currentFcmToken(): String? = fcmToken
    override suspend fun registerOnBackend(token: String): Boolean {
        if (!registerOk) return false
        registered += token
        return true
    }

    override suspend fun unregisterOnBackend(token: String): Boolean {
        unregistered += token
        return true
    }

    override suspend fun stashPending(token: String) {
        pending = token
    }

    override suspend fun readPending(): String? = pending
    override suspend fun clearPending() {
        pending = null
    }
}

class PushRegistrationTest {
    @Test
    fun `onLogin registers fresh token`() = runTest {
        val ops = FakeOps()
        assertEquals("fcm-1", PushRegistration(ops).onLogin())
        assertEquals(listOf("fcm-1"), ops.registered)
    }

    @Test
    fun `onLogin flushes pending token first`() = runTest {
        val ops = FakeOps().apply { pending = "stale-tok" }
        assertEquals("stale-tok", PushRegistration(ops).onLogin())
        assertEquals(listOf("stale-tok"), ops.registered)
        assertNull(ops.pending)
    }

    @Test
    fun `onLogin keeps stash when backend fails`() = runTest {
        val ops = FakeOps().apply { pending = "stale-tok"; registerOk = false }
        assertNull(PushRegistration(ops).onLogin())
        assertEquals("stale-tok", ops.pending)
    }

    @Test
    fun `rotation registers, failure falls back to stash`() = runTest {
        val ok = FakeOps()
        assertEquals("fcm-new", PushRegistration(ok).onNewToken("fcm-new"))

        val fail = FakeOps().apply { registerOk = false }
        assertNull(PushRegistration(fail).onNewToken("fcm-new"))
        assertEquals("fcm-new", fail.pending)
    }

    @Test
    fun `rotation can be stashed without registration`() = runTest {
        val ops = FakeOps()
        PushRegistration(ops).stashPending("fcm-x")
        assertTrue(ops.registered.isEmpty())
        assertEquals("fcm-x", ops.pending)
    }

    @Test
    fun `logout unregisters active token and keeps pending stash`() = runTest {
        val ops = FakeOps().apply { pending = "kept" }
        PushRegistration(ops).onLogout("fcm-1")
        assertEquals(listOf("fcm-1"), ops.unregistered)
        assertEquals("kept", ops.pending)
    }

    @Test
    fun `logout without active token is a no-op`() = runTest {
        val ops = FakeOps()
        PushRegistration(ops).onLogout(null)
        assertTrue(ops.unregistered.isEmpty())
    }
}
