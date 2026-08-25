package ac.undip.sso.core.network

import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig
import io.ktor.client.engine.js.Js
import io.ktor.client.plugins.HttpTimeout

internal actual fun createPlatformClient(
    configure: HttpClientConfig<*>.() -> Unit,
): HttpClient = HttpClient(Js) {
    install(HttpTimeout) {
        connectTimeoutMillis = 15_000
        requestTimeoutMillis = 30_000
        socketTimeoutMillis = 30_000
    }
    configure()
}