package ac.undip.sso.core.push

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/** Exercises the production DataStore-backed compare-and-clear seam. */
class PendingPushTokenStoreTest {
    private fun dataStore(file: File): DataStore<Preferences> =
        PreferenceDataStoreFactory.create(
            scope = CoroutineScope(Dispatchers.IO + SupervisorJob()),
            produceFile = { file },
        )

    @Test
    fun `clearing older expected token preserves newer pending token`() = runBlocking {
        val store = PendingPushTokenStore(dataStore(File.createTempFile("push", ".preferences_pb")))

        store.stash("token-old")
        store.stash("token-new")
        store.clearIfMatches("token-old")

        assertEquals("token-new", store.read())
    }
}
