package ac.undip.sso.ui.login

/**
 * Shared with DebugKulonTicketProbe. Kept in `main` because the debug source
 * set imports it; deleting KulonTicketCapture.kt must not break assembleDebug.
 */
internal val KULON_LANDING_MARKERS_PROBE =
    """
    (function(){
        var hasSesskey = !!document.querySelector('input[name="sesskey"]');
        var hasLoginForm = !!document.querySelector('input[type="password"], form[action*="login"]');
        return hasLoginForm ? 'login' : (hasSesskey ? 'sesskey' : 'unknown');
    })()
    """.trimIndent()
