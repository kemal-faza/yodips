package ac.undip.sso

import ac.undip.sso.core.push.PushGraph
import android.app.Application

/**
 * Process entry: installs [PushGraph] before any component runs, so an FCM
 * token rotation delivered to `PushMessagingService` in a fresh process —
 * before `MainActivity.onCreate` ever executes — finds an installed graph
 * instead of being silently dropped on a null coordinator. Install is
 * idempotent ([PushGraph.install] collapses repeats), so the activity and
 * the service safely ensure it again.
 */
class SsoApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        PushGraph.install(this)
    }
}
