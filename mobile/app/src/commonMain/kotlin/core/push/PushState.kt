package ac.undip.sso.core.push

/** UI state for the PWA notification settings card and opt-in prompt. */
sealed interface PushState {
    data object Unsupported : PushState
    data object VapidUnavailable : PushState
    data object PermissionDefault : PushState
    data object PermissionDenied : PushState
    data object NotSubscribed : PushState
    data class Subscribed(val endpoint: String) : PushState
    data object Working : PushState
    data class Error(val message: String) : PushState
}

/** Browser results reduced into [PushState] without touching DOM APIs. */
sealed interface PushAction {
    data object Started : PushAction
    data object Unsupported : PushAction
    data object VapidMissing : PushAction
    data object PermissionDefault : PushAction
    data object PermissionDenied : PushAction
    data object NoSubscription : PushAction
    data class Subscribed(val endpoint: String) : PushAction
    data class Failed(val message: String) : PushAction
}

object PushStateReducer {
    fun reduce(action: PushAction): PushState =
        when (action) {
            PushAction.Started -> PushState.Working
            PushAction.Unsupported -> PushState.Unsupported
            PushAction.VapidMissing -> PushState.VapidUnavailable
            PushAction.PermissionDefault -> PushState.PermissionDefault
            PushAction.PermissionDenied -> PushState.PermissionDenied
            PushAction.NoSubscription -> PushState.NotSubscribed
            is PushAction.Subscribed -> PushState.Subscribed(action.endpoint)
            is PushAction.Failed -> PushState.Error(action.message)
        }
}
