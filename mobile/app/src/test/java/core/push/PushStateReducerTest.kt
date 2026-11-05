package ac.undip.sso.core.push

import org.junit.Assert.assertEquals
import org.junit.Test

class PushStateReducerTest {
    @Test
    fun `started enters working`() {
        assertEquals(PushState.Working, PushStateReducer.reduce(PushAction.Started))
    }

    @Test
    fun `browser and server prerequisites map to terminal states`() {
        assertEquals(PushState.Unsupported, PushStateReducer.reduce(PushAction.Unsupported))
        assertEquals(PushState.VapidUnavailable, PushStateReducer.reduce(PushAction.VapidMissing))
        assertEquals(PushState.PermissionDefault, PushStateReducer.reduce(PushAction.PermissionDefault))
        assertEquals(PushState.PermissionDenied, PushStateReducer.reduce(PushAction.PermissionDenied))
        assertEquals(PushState.NotSubscribed, PushStateReducer.reduce(PushAction.NoSubscription))
    }

    @Test
    fun `subscribed carries the endpoint`() {
        assertEquals(
            PushState.Subscribed("https://push.example/abc"),
            PushStateReducer.reduce(PushAction.Subscribed("https://push.example/abc")),
        )
    }

    @Test
    fun `failure carries the user-facing message`() {
        assertEquals(
            PushState.Error("Gagal mengaktifkan notifikasi."),
            PushStateReducer.reduce(PushAction.Failed("Gagal mengaktifkan notifikasi.")),
        )
    }
}
