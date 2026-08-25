package ac.undip.sso.core.push

import ac.undip.sso.MainActivity
import ac.undip.sso.R
import ac.undip.sso.core.network.Backend
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.launch

const val CHANNEL_AKADEMIK = "akademik"

fun ensureAkademikChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = context.getSystemService(NotificationManager::class.java) ?: return
    if (mgr.getNotificationChannel(CHANNEL_AKADEMIK) != null) return
    mgr.createNotificationChannel(
        NotificationChannel(CHANNEL_AKADEMIK, "Akademik", NotificationManager.IMPORTANCE_DEFAULT),
    )
}

/** Tampilkan notifikasi sistem; tap membuka MainActivity dengan extras target/payload. */
@SuppressLint("MissingPermission") // POST_NOTIFICATIONS diminta runtime terpisah setelah login
fun showPush(
    context: Context,
    title: String,
    body: String,
    target: String?,
    payload: String?,
) {
    ensureAkademikChannel(context)
    val intent =
        Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra("target", target)
            putExtra("payload", payload)
        }
    val requestCode = (title + body).hashCode()
    val pi =
        PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    val notif =
        NotificationCompat.Builder(context, CHANNEL_AKADEMIK)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
    NotificationManagerCompat.from(context).notify(requestCode, notif)
}

/**
 * Adapter tipis Firebase -> PushGraph. Callback FCM berjalan di thread
 * background sehingga blocking singkat aman; logika keputusan ada di
 * [PushRegistration] (teruji JVM).
 */
class PushMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val loggedIn = !Backend.authToken.isNullOrBlank()
        PushGraph.ioScope.launch { PushGraph.onNewToken(token, loggedIn) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // Saat app BACKGROUND, payload `notification` dirender sistem otomatis;
        // onMessageReceived hanya menyentuh data-only atau app FOREGROUND.
        val title = message.notification?.title ?: message.data["title"] ?: return
        val body = message.notification?.body ?: message.data["body"] ?: ""
        showPush(this, title, body, message.data["target"], message.data["payload"])
    }
}
