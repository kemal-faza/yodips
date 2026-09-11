package ac.undip.sso.core.network

class ApiHttpException(
    val status: Int,
    override val message: String,
    /** Backend `{ code }` envelope value, when the error body carried one. */
    val code: String? = null,
) : Exception(message)
