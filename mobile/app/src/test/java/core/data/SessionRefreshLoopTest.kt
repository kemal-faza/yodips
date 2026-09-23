package ac.undip.sso.core.data

import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class SessionRefreshLoopTest {
    @Test
    fun `foreground loop retries at interval and reports a dead session`() = runTest {
        var calls = 0
        var expired = false

        backgroundScope.launch {
            runSessionRefreshLoop(
                ensureFresh = {
                    calls += 1
                    if (calls == 2) {
                        SessionRefresher.RefreshResult.DEAD_SESSION
                    } else {
                        SessionRefresher.RefreshResult.SUCCESS
                    }
                },
                onDeadSession = { expired = true },
                intervalMs = 1_000,
            )
        }

        runCurrent()
        assertEquals(1, calls)
        assertTrue(!expired)

        advanceTimeBy(1_000)
        runCurrent()

        assertEquals(2, calls)
        assertTrue(expired)
    }
}
