package ac.undip.sso.ui.feature

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ScanSubmissionGateTest {
    @Test
    fun `parallel camera and gallery decodes claim only one request`() {
        val processing = AtomicBoolean(false)
        val start = CountDownLatch(1)
        val accepted = AtomicInteger(0)
        val executor = Executors.newFixedThreadPool(2)

        try {
            val attempts = (1..2).map {
                executor.submit {
                    start.await()
                    if (tryStartScanRequest(processing)) accepted.incrementAndGet()
                }
            }
            start.countDown()
            attempts.forEach { it.get(5, TimeUnit.SECONDS) }

            assertEquals(1, accepted.get())
            assertTrue(processing.get())

            // Only the explicit user reset after the result releases the gate.
            processing.set(false)
            assertTrue(tryStartScanRequest(processing))
        } finally {
            executor.shutdownNow()
        }
    }
}
