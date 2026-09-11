package ac.undip.sso.core.network

import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import okhttp3.CertificatePinner

internal actual fun createPlatformClient(
    configure: HttpClientConfig<*>.() -> Unit,
): HttpClient = HttpClient(OkHttp) {
    install(HttpTimeout) {
        connectTimeoutMillis = 15_000
        requestTimeoutMillis = 30_000
        socketTimeoutMillis = 30_000
    }
    engine {
        config {
            certificatePinner(
                CertificatePinner.Builder()
                    .add(
                        "backend.crunchy.my.id",
                        "sha256/kQsdoAmDUNHVpLtovFJwVA6FYPpS1/IdstEYLYBX5+U=",
                        "sha256/kIdp6NNEd8wsugYyyIYFsi1ylMCED3hZbSR8ZFsa/A4=",
                    )
                    .build()
            )
        }
    }
    configure()
}
