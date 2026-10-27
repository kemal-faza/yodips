package ac.undip.sso.ui.login

import ac.undip.sso.core.data.DirectTicketCaptureResult
import ac.undip.sso.core.network.UpstreamSessionService
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class KulonTicketCaptureBridgeTest {
    @Test
    fun `recovery starts ticket capture without waiting for user confirmation`() = runBlocking {
        val bridge = KulonTicketCaptureBridge()
        val result = async { bridge.capture(UpstreamSessionService.KULON) }
        yield()
        val request = bridge.request.value
        assertNotNull(request)
        assertEquals(KulonTicketCaptureBridge.Stage.CAPTURING, request!!.stage.value)
        request.finish(DirectTicketCaptureResult.NetworkFailure)
        assertEquals(DirectTicketCaptureResult.NetworkFailure, result.await())
    }

    @Test
    fun `SIAP recovery also starts ticket capture without user confirmation`() = runBlocking {
        val bridge = KulonTicketCaptureBridge()
        val result = async { bridge.capture(UpstreamSessionService.SIAP) }
        yield()
        val request = bridge.request.value
        assertNotNull(request)
        assertEquals(KulonTicketCaptureBridge.Stage.CAPTURING, request!!.stage.value)
        request.finish(DirectTicketCaptureResult.Authenticated("sia_app_session=new"))
        assertEquals(DirectTicketCaptureResult.Authenticated("sia_app_session=new"), result.await())
    }
}
