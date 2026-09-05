package ac.undip.sso.core.push

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Locks the idempotent/thread-safe install-publication lifecycle behind
 * [PushGraph.install] through the REAL production [PushInstallOnce] gate —
 * one fresh instance per test via normal construction, so suites isolate
 * state with no [PushGraph] global mutation and no reflection:
 *  - sequential double-ensure builds exactly once;
 *  - concurrent ensures while the first build is paused collapse into that
 *    single build (no duplicate Firebase/DataStore wiring);
 *  - a throwing build does NOT latch: the next ensure retries.
 *
 * Production wiring ([PushGraph.install] from `SsoApplication.onCreate`,
 * `MainActivity.onCreate`, and `PushMessagingService.onNewToken`) delegates
 * to this gate, so an FCM token arriving in a fresh process — before any
 * activity ran — finds an installed graph instead of being silently
 * dropped on a null coordinator.
 */
class PushInstallOnceTest {
    @Test
    fun `sequential double ensure builds exactly once`() {
        val gate = PushInstallOnce()
        var builds = 0
        gate.ensure { builds++ }
        gate.ensure { builds++ }
        assertEquals(1, builds)
    }

    @Test
    fun `concurrent ensures from two threads build exactly once`() {
        // Real threads + latches (no sleeps): the second ensure must queue
        // on the gate while the first build is held open, then return
        // without rebuilding once released.
        val gate = PushInstallOnce()
        val buildEntered = CountDownLatch(1)
        val releaseBuild = CountDownLatch(1)
        val builds = AtomicInteger(0)
        val first =
            thread {
                gate.ensure {
                    builds.incrementAndGet()
                    buildEntered.countDown()
                    releaseBuild.await() // hold the first build open in-gate
                }
            }
        assertTrue("first build never started", buildEntered.await(5, TimeUnit.SECONDS))
        val second = thread { gate.ensure { builds.incrementAndGet() } }
        second.join(1000)
        assertTrue("second ensure must wait for the running build, not rebuild", second.isAlive)
        assertEquals(1, builds.get())
        releaseBuild.countDown()
        first.join(5000)
        second.join(5000)
        assertEquals(1, builds.get())
    }

    @Test
    fun `throwing build does not latch, next ensure retries`() {
        val gate = PushInstallOnce()
        var builds = 0
        try {
            gate.ensure {
                builds++
                throw IllegalStateException("boom")
            }
        } catch (expected: IllegalStateException) {
            // propagates — install failure must stay visible
        }
        gate.ensure { builds++ }
        assertEquals(2, builds)
    }
}
