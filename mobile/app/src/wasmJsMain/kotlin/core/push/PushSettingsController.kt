package ac.undip.sso.core.push

import ac.undip.sso.core.network.Backend
import ac.undip.sso.core.network.SsoApi
import ac.undip.sso.nowMs
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class PushSettingsController(
    private val api: SsoApi = Backend.api,
) {
    private val _state = MutableStateFlow<PushState>(PushState.Working)
    val state: StateFlow<PushState> = _state.asStateFlow()

    private fun apply(action: PushAction) {
        _state.value = PushStateReducer.reduce(action)
    }

    suspend fun refresh() {
        apply(PushAction.Started)
        if (!PushSubscriptionManager.isSupported()) {
            apply(PushAction.Unsupported)
            return
        }
        val vapid = runCatching { api.vapidPublicKey().publicKey }.getOrNull()
        if (vapid.isNullOrBlank()) {
            apply(PushAction.VapidMissing)
            return
        }
        when (PushSubscriptionManager.permission()) {
            "denied" -> apply(PushAction.PermissionDenied)
            "default" -> apply(PushAction.PermissionDefault)
            "granted" -> {
                val sub = runCatching { PushSubscriptionManager.currentSubscription() }.getOrNull()
                if (sub == null) apply(PushAction.NoSubscription)
                else apply(PushAction.Subscribed(sub.endpoint))
            }
            else -> apply(PushAction.Unsupported)
        }
    }

    suspend fun enable() {
        if (!PushSubscriptionManager.isSupported()) {
            apply(PushAction.Unsupported)
            return
        }
        apply(PushAction.Started)
        when (PushSubscriptionManager.requestPermission()) {
            "denied" -> {
                apply(PushAction.PermissionDenied)
                return
            }
            "granted" -> Unit
            else -> {
                apply(PushAction.PermissionDefault)
                return
            }
        }
        val vapid = runCatching { api.vapidPublicKey().publicKey }.getOrNull()
        if (vapid.isNullOrBlank()) {
            apply(PushAction.VapidMissing)
            return
        }
        val sub = runCatching { PushSubscriptionManager.subscribe(vapid) }.getOrNull()
        if (sub == null) {
            apply(PushAction.NoSubscription)
            return
        }
        val registered = runCatching { api.registerWebPushDevice(sub) }.isSuccess
        if (registered) {
            setLastEndpoint(sub.endpoint)
            apply(PushAction.Subscribed(sub.endpoint))
        } else {
            apply(PushAction.Failed("Gagal mendaftarkan notifikasi."))
        }
    }

    suspend fun disable() {
        val sub = runCatching { PushSubscriptionManager.currentSubscription() }.getOrNull()
        if (sub != null) runCatching { api.unregisterWebPushDevice(sub) }
        runCatching { PushSubscriptionManager.unsubscribe() }
        clearLastEndpoint()
        apply(PushAction.NoSubscription)
    }

    suspend fun reconcile() {
        if (!PushSubscriptionManager.isSupported()) return
        if (PushSubscriptionManager.permission() != "granted") return
        if (nowMs() - lastReconciledAt() < 5 * 60_000L) return
        val vapid = runCatching { api.vapidPublicKey().publicKey }.getOrNull()
        if (vapid.isNullOrBlank()) return
        val sub = runCatching { PushSubscriptionManager.currentSubscription() }.getOrNull()
            ?: runCatching { PushSubscriptionManager.subscribe(vapid) }.getOrNull()
            ?: return
        if (sub.endpoint != lastEndpoint()) {
            runCatching { api.registerWebPushDevice(sub) }
            setLastEndpoint(sub.endpoint)
        }
        apply(PushAction.Subscribed(sub.endpoint))
        setLastReconciledAt(nowMs())
    }

    fun isPromptDismissed(): Boolean = promptDismissed()

    fun shouldPrompt(): Boolean =
        _state.value == PushState.PermissionDefault && !promptDismissed()

    fun dismissPrompt() = setPromptDismissed()
}

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun("(key) => { try { return localStorage.getItem(key); } catch (e) { return null; } }")
private external fun jsStorageGet(key: String): String?

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun("(key, value) => { try { localStorage.setItem(key, value); } catch (e) {} }")
private external fun jsStorageSet(key: String, value: String)

private const val KEY_ENDPOINT = "sso_push_endpoint"
private const val KEY_RECONCILED = "sso_push_reconciled_at"
private const val KEY_PROMPT = "sso_push_prompt_v1"

private fun lastEndpoint(): String? = jsStorageGet(KEY_ENDPOINT)
private fun setLastEndpoint(value: String) = jsStorageSet(KEY_ENDPOINT, value)
private fun clearLastEndpoint() = jsStorageSet(KEY_ENDPOINT, "")
private fun lastReconciledAt(): Long = jsStorageGet(KEY_RECONCILED)?.toLongOrNull() ?: 0L
private fun setLastReconciledAt(value: Long) = jsStorageSet(KEY_RECONCILED, value.toString())
private fun promptDismissed(): Boolean = jsStorageGet(KEY_PROMPT) == "1"
private fun setPromptDismissed() = jsStorageSet(KEY_PROMPT, "1")
