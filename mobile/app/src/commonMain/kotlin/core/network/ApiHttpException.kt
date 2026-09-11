package ac.undip.sso.core.network

class ApiHttpException(val status: Int, override val message: String) : Exception(message)
